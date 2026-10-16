import { OpenAPIObject } from '@nestjs/swagger';
import { API_TAGS } from '../../src/swagger';

/**
 * The "Swagger completeness audit": checks that every endpoint is documented well enough for a web
 * or mobile developer to build a screen WITHOUT asking the backend developer.
 * The rules come from docs/03-engineering/api-docs-standard.md.
 *
 * It returns a list of readable problems; an empty list means the API manual is complete.
 * The test uses it on the real API (must be empty) and on deliberately bad routes (must complain).
 *
 * This is a "skeleton": it checks that the pieces EXIST. Whether the text is good is for code review.
 */

type Operation = {
  tags?: string[];
  operationId?: string;
  summary?: string;
  description?: string;
  security?: unknown[];
  requestBody?: unknown;
  parameters?: Array<{ in?: string }>;
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { example?: unknown; examples?: unknown }> }
  >;
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function findSwaggerViolations(document: OpenAPIObject): string[] {
  const problems: string[] = [];
  const operationIds = new Map<string, string>();

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];
      if (!operation) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const problem = (text: string): number => problems.push(`${where}: ${text}`);

      // 1. Grouped under a known section.
      if (!operation.tags?.length) problem('has no @ApiTags section.');
      for (const tag of operation.tags ?? []) {
        if (!API_TAGS.includes(tag))
          problem(`uses unknown section "${tag}" (add it to API_TAGS or use an existing one).`);
      }

      // 2. A unique, readable operation id (apps use it as the function name).
      const id = operation.operationId;
      if (!id || !/^[a-z][A-Za-z0-9]*$/.test(id)) {
        problem(
          `needs an operationId in camelCase verbNoun form (found "${id ?? 'none'}"). Set it in @ApiOperation.`,
        );
      } else if (operationIds.has(id)) {
        problem(`operationId "${id}" is already used by ${operationIds.get(id)}.`);
      } else {
        operationIds.set(id, where);
      }

      // 3. A short summary and a description that names the required permission.
      if (!operation.summary?.trim()) problem('has no summary.');
      else if (operation.summary.trim().split(/\s+/).length > 10)
        problem('summary is longer than 10 words.');
      if (!operation.description?.trim()) problem('has no description.');
      else if (!/Permission:\s*\S+/.test(operation.description)) {
        problem(
          'description must state the required permission, for example "Permission: pos.sell" or "Permission: public".',
        );
      }

      // 4. At least one documented success response.
      const responses = operation.responses ?? {};
      const statuses = Object.keys(responses);
      const success = statuses.filter((s) => /^[23]\d\d$/.test(s));
      if (success.length === 0) problem('documents no success response (2xx).');
      for (const status of success) {
        if (!responses[status]?.description?.trim())
          problem(`success response ${status} has no description.`);
      }

      // 5. Error responses, each with the standard body and an example.
      const errors = statuses.filter((s) => /^[45]\d\d$/.test(s));
      if (errors.length === 0) problem('documents no error responses (4xx/5xx).');
      for (const status of errors) {
        const media = responses[status]?.content?.['application/problem+json'];
        if (!media)
          problem(
            `error ${status} must use @ApiProblemResponse (standard application/problem+json body).`,
          );
        else if (media.example === undefined && media.examples === undefined)
          problem(`error ${status} has no example.`);
      }

      // 6. Errors that necessarily apply to certain kinds of endpoint.
      if (operation.security?.length) {
        if (!errors.includes('401'))
          problem('is protected but does not document 401 (UNAUTHENTICATED).');
        if (!errors.includes('403')) problem('is protected but does not document 403 (FORBIDDEN).');
      }
      if (path.includes('{') && !errors.includes('404'))
        problem('has a path parameter but does not document 404 (NOT_FOUND).');
      if (operation.requestBody && !errors.includes('400'))
        problem('accepts a body but does not document 400 (VALIDATION_FAILED).');
    }
  }
  return problems;
}
