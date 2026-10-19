import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/errors/domain-error';
import { ApiProblemResponse } from '../../common/swagger/api-problem-response.decorator';
import { RequestInfo } from '../audit/audit.service';
import { ClientInfo } from '../auth/http/decorators';
import { LoadedAccess } from '../permissions/access.service';
import { Authenticated, Permission } from '../permissions/permission.decorators';
import { BusinessService } from './business.service';
import { UpdateBusinessDto } from './dto/business-requests.dto';
import { BusinessProfileDto, GstStateListDto, OnboardingDto } from './dto/business-responses.dto';

/** Largest logo accepted (2 MB; a shop logo needs far less). */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** The signed-in person's access, loaded by the permissions guard before any of these methods run. */
function accessOf(request: Request): LoadedAccess {
  if (!request.access) throw new Error('Permissions guard did not run for a business route.');
  return request.access;
}

/**
 * The business profile and the first-steps checklist.
 *
 * Anyone signed in may READ the profile (the till prints the name and address on receipts); only people with
 * `settings.manage` (the owner by default) may CHANGE it.
 */
@ApiTags('Tenants & Business')
@ApiBearerAuth('staff-bearer')
@Controller('v1/business')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  @Authenticated()
  @ApiOperation({
    operationId: 'getBusinessProfile',
    summary: 'Get the business profile',
    description:
      "Name, GSTIN, state, address and phone of the signed-in person's business.\n\nPermission: any signed-in user (own account).",
  })
  @ApiOkResponse({ type: BusinessProfileDto, description: 'The business profile.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getBusinessProfile(): Promise<BusinessProfileDto> {
    return this.business.get();
  }

  @Put()
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'updateBusinessProfile',
    summary: 'Change the business profile',
    description:
      'Replaces the profile. The state is required because it decides CGST+SGST versus IGST. A GSTIN is optional (a shop not registered for GST has none), but if given its check character is verified, it must start with the chosen state code, and it must keep the same PAN as the GSTINs of the branches.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: BusinessProfileDto, description: 'The saved profile.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [
      {
        field: 'gstin',
        message:
          'This GSTIN has a typing mistake: its last character does not match the others. Compare it with your GST certificate.',
      },
    ],
  })
  @ApiProblemResponse('BUSINESS_RULE_VIOLATION', {
    detail:
      'A branch already has a GSTIN with a different PAN. Fix the branch first, or use the same PAN.',
  })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  updateBusinessProfile(
    @Req() request: Request,
    @Body() dto: UpdateBusinessDto,
    @ClientInfo() info: RequestInfo,
  ): Promise<BusinessProfileDto> {
    return this.business.update(accessOf(request), dto, info);
  }

  @Put('logo')
  @Permission('settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP, up to 2 MB.' },
      },
    },
  })
  @ApiOperation({
    operationId: 'uploadBusinessLogo',
    summary: 'Upload the logo',
    description:
      "Replaces the logo with a PNG, JPEG or WebP image (up to 2 MB). The file's contents are checked, not just its name.\n\nPermission: settings.manage",
  })
  @ApiOkResponse({ type: BusinessProfileDto, description: 'The profile, now with a logo.' })
  @ApiProblemResponse('VALIDATION_FAILED', {
    errors: [{ field: 'file', message: 'Choose an image file.' }],
  })
  @ApiProblemResponse('FILE_TYPE_NOT_ALLOWED', {
    detail: 'A logo must be a PNG, JPEG or WebP image.',
  })
  @ApiProblemResponse('FILE_CONTENT_MISMATCH')
  @ApiProblemResponse('FILE_EMPTY')
  @ApiProblemResponse('PAYLOAD_TOO_LARGE')
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  uploadBusinessLogo(
    @Req() request: Request,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined,
    @ClientInfo() info: RequestInfo,
  ): Promise<BusinessProfileDto> {
    if (!file) {
      throw new DomainError('VALIDATION_FAILED', 'Some fields are invalid.', [
        { field: 'file', message: 'Choose an image file.' },
      ]);
    }
    return this.business.setLogo(accessOf(request), file, info);
  }

  @Get('logo')
  @Authenticated()
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiOperation({
    operationId: 'getBusinessLogo',
    summary: 'Download the logo',
    description:
      'The logo image. Needs the bearer token, so the app fetches it and shows it from memory rather than with a plain image link.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({
    description: 'The image.',
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiProblemResponse('NOT_FOUND', { detail: 'This business has no logo.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async getBusinessLogo(@Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const { file, contentType, size } = await this.business.openLogo();
    response.set({
      'Content-Type': contentType,
      'Content-Length': String(size),
      // Private data behind a login: never stored by shared caches. `no-cache` makes browsers re-check after a change.
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    return file;
  }

  @Delete('logo')
  @HttpCode(204)
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'removeBusinessLogo',
    summary: 'Remove the logo',
    description: 'Deletes the logo. Safe to repeat.\n\nPermission: settings.manage',
  })
  @ApiNoContentResponse({ description: 'The logo is gone.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  async removeBusinessLogo(
    @Req() request: Request,
    @ClientInfo() info: RequestInfo,
  ): Promise<void> {
    await this.business.removeLogo(accessOf(request), info);
  }

  @Get('gst-states')
  @Authenticated()
  @ApiOperation({
    operationId: 'listGstStates',
    summary: 'List GST states',
    description:
      'The official GST state codes (01 to 38, and 97, 99) for the state picker.\n\nPermission: any signed-in user (own account).',
  })
  @ApiOkResponse({ type: GstStateListDto, description: 'The states, sorted by name.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  listGstStates(): Promise<GstStateListDto> {
    return this.business.states();
  }

  @Get('onboarding')
  @Permission('settings.manage')
  @ApiOperation({
    operationId: 'getOnboardingChecklist',
    summary: 'First-steps checklist',
    description:
      'Which first steps are done (business profile, a branch with its address, a second person on the team) and whether a GSTIN is missing. Computed from real data, so a step turns done by doing the work, not by ticking a box.\n\nPermission: settings.manage',
  })
  @ApiOkResponse({ type: OnboardingDto, description: 'The checklist.' })
  @ApiProblemResponse('UNAUTHENTICATED')
  @ApiProblemResponse('FORBIDDEN')
  @ApiProblemResponse('INTERNAL_ERROR')
  getOnboardingChecklist(): Promise<OnboardingDto> {
    return this.business.onboarding();
  }
}
