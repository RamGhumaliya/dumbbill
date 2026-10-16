import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import { LoggerModule } from 'nestjs-pino';
import { ApiProblemResponse } from '../../src/common/swagger/api-problem-response.decorator';
import { createApiDocument } from '../../src/swagger';
import { findSwaggerViolations } from '../support/swagger-audit';

/**
 * Guard for the API manual. Every route must be documented per docs/03-engineering/api-docs-standard.md,
 * or this test fails and names the route and the missing piece.
 *
 * The first test checks the REAL application. The others prove the audit is not asleep: they feed it
 * deliberately bad routes and expect complaints.
 */
describe('Swagger completeness', () => {
  it('every route of the real API is fully documented', async () => {
    // The app module validates settings when it is loaded, so set them first.
    Object.assign(process.env, {
      NODE_ENV: 'production', // plain JSON logs: no pretty-printing worker thread in tests
      LOG_LEVEL: 'fatal',
      APP_DATABASE_URL: 'postgresql://app:app@localhost:5432/unused',
      REDIS_URL: 'redis://localhost:6379',
    });
    const { AppModule } = await import('../../src/app.module');
    const app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    try {
      const document = createApiDocument(app);
      expect(Object.keys(document.paths).length).toBeGreaterThan(0);
      expect(findSwaggerViolations(document)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  describe('the audit catches bad routes', () => {
    class ItemDto {
      @IsString()
      name!: string;
    }

    /** A route a careless developer might write: nothing is documented. */
    @Controller('bad')
    class UndocumentedController {
      @Get('thing/:id')
      thing(): string {
        return 'x';
      }
    }

    /** A route with a success response only: no permission note, no errors. */
    @ApiTags('System')
    @Controller('half')
    class HalfDocumentedController {
      @Post()
      @ApiOperation({ summary: 'Create a thing', description: 'Creates a thing.' })
      @ApiOkResponse({ description: 'Created.' })
      createThing(@Body() _body: ItemDto): string {
        return 'x';
      }
    }

    /** A protected route that forgot 401/403/404/400. */
    @ApiTags('System')
    @ApiBearerAuth('staff-bearer')
    @Controller('secure')
    class ForgotAuthErrorsController {
      @Post(':id')
      @ApiOperation({
        operationId: 'updateThing',
        summary: 'Update a thing',
        description: 'Changes a thing.\n\nPermission: things.write',
      })
      @ApiOkResponse({ description: 'Updated.' })
      @ApiProblemResponse('CONFLICT')
      updateThing(@Body() _body: ItemDto): string {
        return 'x';
      }
    }

    /** A route documented the way the standard asks. Must produce no complaints. */
    @ApiTags('System')
    @ApiBearerAuth('staff-bearer')
    @Controller('good')
    class WellDocumentedController {
      @Post(':id')
      @ApiOperation({
        operationId: 'renameThing',
        summary: 'Rename a thing',
        description: 'Renames a thing.\n\nPermission: things.write',
      })
      @ApiOkResponse({ description: 'Renamed.' })
      @ApiProblemResponse('VALIDATION_FAILED', {
        errors: [{ field: 'name', message: 'should not be empty' }],
      })
      @ApiProblemResponse('UNAUTHENTICATED')
      @ApiProblemResponse('FORBIDDEN')
      @ApiProblemResponse('NOT_FOUND')
      renameThing(@Body() _body: ItemDto): string {
        return 'x';
      }
    }

    async function documentFor(...controllers: Array<new () => unknown>) {
      const app = (
        await Test.createTestingModule({
          imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } })],
          controllers,
        }).compile()
      ).createNestApplication();
      await app.init();
      try {
        return findSwaggerViolations(createApiDocument(app));
      } finally {
        await app.close();
      }
    }

    it('flags a route with no documentation at all', async () => {
      const text = (await documentFor(UndocumentedController)).join('\n');
      // Nest auto-tags a controller with its own name, which is not one of our official sections.
      expect(text).toMatch(/GET \/bad\/thing\/\{id\}: uses unknown section "Undocumented"/);
      expect(text).toMatch(/has no summary/);
      expect(text).toMatch(/has no description/);
      expect(text).toMatch(/success response 200 has no description/);
      expect(text).toMatch(/documents no error responses/);
      expect(text).toMatch(/path parameter but does not document 404/);
    });

    it('flags a missing permission note and missing error responses', async () => {
      const text = (await documentFor(HalfDocumentedController)).join('\n');
      expect(text).toMatch(/POST \/half: description must state the required permission/);
      expect(text).toMatch(/documents no error responses/);
    });

    it('flags a protected route that forgot 401, 403, 404 and 400', async () => {
      const text = (await documentFor(ForgotAuthErrorsController)).join('\n');
      expect(text).toMatch(/does not document 401/);
      expect(text).toMatch(/does not document 403/);
      expect(text).toMatch(/does not document 404/);
      expect(text).toMatch(/accepts a body but does not document 400/);
    });

    it('accepts a route documented the way the standard asks', async () => {
      expect(await documentFor(WellDocumentedController)).toEqual([]);
    });

    it('flags two routes sharing an operationId', async () => {
      @ApiTags('System')
      @Controller('dup')
      class DuplicateIdController {
        @Get('a')
        @ApiOperation({
          operationId: 'sameName',
          summary: 'A',
          description: 'A.\n\nPermission: public',
        })
        @ApiOkResponse({ description: 'ok' })
        @ApiProblemResponse('INTERNAL_ERROR')
        first(): string {
          return 'a';
        }

        @Get('b')
        @ApiOperation({
          operationId: 'sameName',
          summary: 'B',
          description: 'B.\n\nPermission: public',
        })
        @ApiOkResponse({ description: 'ok' })
        @ApiProblemResponse('INTERNAL_ERROR')
        second(): string {
          return 'b';
        }
      }
      expect((await documentFor(DuplicateIdController)).join('\n')).toMatch(
        /operationId "sameName" is already used/,
      );
    });
  });
});
