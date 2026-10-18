import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Sections shown in the Swagger UI, in this order. Every controller must use one of these
 * names in @ApiTags, so related endpoints stay grouped. The list follows
 * docs/03-engineering/api-docs-standard.md.
 */
export const API_TAGS = [
  'Auth',
  'Tenants & Business',
  'Branches',
  'Team & Permissions',
  'Products',
  'Pricing',
  'Suppliers',
  'Purchases',
  'Inventory',
  'POS & Invoices',
  'Discount Approvals',
  'Shifts',
  'Tax',
  'Loyalty (staff)',
  'Customer App',
  'Reports',
  'Billing & Plans',
  'Notifications',
  'Files',
  'Audit',
  'Super Admin',
  'System',
];

/** Intro text at the top of the Swagger page. It is the first thing web and mobile developers read. */
const DESCRIPTION = `
Dumbbill API: multi-tenant backend for protein and supplement retailers in India.

**Conventions**
- **Money** is always an integer in **paise** (₹1 = 100). Never floats.
- **Time** is ISO-8601 UTC. The apps display Asia/Kolkata.
- **Tenancy**: every request is scoped to the business in the access token. Resources of other businesses return **404**.
- **Auth**: \`Authorization: Bearer <access token>\` (15 minutes). Renew with the refresh token, which works once and is replaced each time (browser apps keep it in an httpOnly cookie and send \`X-CSRF-Token\`; mobile apps keep it in secure storage). Staff and customer tokens are separate. Every route needs a token unless its description says \`Permission: public\`. Full guide: docs/api/auth-flow.md.
- **Idempotency**: money-creating POSTs require an \`Idempotency-Key\` header; retrying with the same key returns the original result.
- **Pagination**: cursor-based (\`cursor\`, \`limit\` up to 100, response \`nextCursor\`).
- **Errors**: RFC 9457 \`application/problem+json\` with a stable machine \`code\` and a \`requestId\` to quote to support.
- **Rate limits**: 429 with \`Retry-After\`.
`;

/**
 * Builds the OpenAPI document for the whole API.
 * Operation ids are the controller method names (for example `getReadiness`), so every method
 * must have a unique, descriptive name: apps use them as function names when integrating.
 * Split out from setupSwagger so tests can inspect the exact same document.
 */
export function createApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Dumbbill API')
    .setDescription(DESCRIPTION)
    .setVersion('0.1.0')
    .addServer('http://localhost:3000', 'Local development')
    // Two separate login systems: shop staff (owner/admin/cashier) and shoppers (loyalty app).
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'staff-bearer')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'customer-bearer');
  API_TAGS.forEach((tag) => builder.addTag(tag));
  return SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}

/** Publishes the interactive docs at /docs and the raw OpenAPI file at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createApiDocument(app), { jsonDocumentUrl: 'docs-json' });
}
