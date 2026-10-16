import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
- **Auth**: \`Authorization: Bearer <access token>\`. Staff and customer tokens are separate.
- **Idempotency**: money-creating POSTs require an \`Idempotency-Key\` header; retrying with the same key returns the original result.
- **Pagination**: cursor-based (\`cursor\`, \`limit\` up to 100, response \`nextCursor\`).
- **Errors**: RFC 9457 \`application/problem+json\` with a stable machine \`code\` and a \`requestId\` to quote to support.
- **Rate limits**: 429 with \`Retry-After\`.
`;

/** Publishes the interactive docs at /docs and the raw OpenAPI file at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Dumbbill API')
    .setDescription(DESCRIPTION)
    .setVersion('0.1.0')
    .addServer('http://localhost:3000', 'Local development')
    // Two separate login systems: shop staff (owner/admin/cashier) and shoppers (loyalty app).
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'staff-bearer')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'customer-bearer');
  API_TAGS.forEach((tag) => builder.addTag(tag));
  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
