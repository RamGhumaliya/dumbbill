# Who may call which route

Generated from the real routes and the built-in role presets by `test/integration/role-route-matrix.spec.ts`; do not edit by hand.
Refresh after an intended change with `UPDATE_DOCS=1 pnpm test:int -- role-route-matrix`, and review the diff: a new `yes` in the Cashier column is a decision, not a side effect.

Businesses can edit the Admin and Cashier roles, add their own roles, and grant or take away single permissions per person, so this shows the STARTING setup. The Owner always holds every permission. Branch rules (a person only reaches the branches assigned to them) apply on top of this table.

| Method | Route                                           | Needs                              | Owner | Admin | Cashier |
| ------ | ----------------------------------------------- | ---------------------------------- | ----- | ----- | ------- |
| GET    | `/healthz`                                      | public                             | yes   | yes   | yes     |
| GET    | `/readyz`                                       | public                             | yes   | yes   | yes     |
| GET    | `/v1/audit`                                     | `audit.read`                       | yes   | yes   | -       |
| GET    | `/v1/audit/verify`                              | `audit.read`                       | yes   | yes   | -       |
| POST   | `/v1/auth/accept-invitation`                    | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/change-password`                      | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/forgot-password`                      | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/login`                                | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/logout`                               | public                             | yes   | yes   | yes     |
| GET    | `/v1/auth/me`                                   | any signed-in user                 | yes   | yes   | yes     |
| PUT    | `/v1/auth/pin`                                  | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/pin/clear`                            | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/refresh`                              | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/resend-verification`                  | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/reset-password`                       | public                             | yes   | yes   | yes     |
| GET    | `/v1/auth/sessions`                             | any signed-in user                 | yes   | yes   | yes     |
| DELETE | `/v1/auth/sessions/{sessionId}`                 | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/signup`                               | public                             | yes   | yes   | yes     |
| POST   | `/v1/auth/totp/disable`                         | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/totp/enable`                          | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/totp/setup`                           | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/auth/verify-email`                         | public                             | yes   | yes   | yes     |
| GET    | `/v1/branches`                                  | any signed-in user                 | yes   | yes   | yes     |
| POST   | `/v1/branches`                                  | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/branches/{branchId}`                       | any signed-in user                 | yes   | yes   | yes     |
| PUT    | `/v1/branches/{branchId}`                       | `settings.manage`                  | yes   | yes   | -       |
| POST   | `/v1/branches/{branchId}/activate`              | `settings.manage`                  | yes   | yes   | -       |
| POST   | `/v1/branches/{branchId}/deactivate`            | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/business`                                  | any signed-in user                 | yes   | yes   | yes     |
| PUT    | `/v1/business`                                  | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/business/gst-states`                       | any signed-in user                 | yes   | yes   | yes     |
| DELETE | `/v1/business/logo`                             | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/business/logo`                             | any signed-in user                 | yes   | yes   | yes     |
| PUT    | `/v1/business/logo`                             | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/business/onboarding`                       | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/products`                                  | `products.read`                    | yes   | yes   | yes     |
| POST   | `/v1/products`                                  | `products.write` + `pricing.write` | yes   | yes   | -       |
| GET    | `/v1/products/{productId}`                      | `products.read`                    | yes   | yes   | yes     |
| PUT    | `/v1/products/{productId}`                      | `products.write`                   | yes   | yes   | -       |
| POST   | `/v1/products/{productId}/activate`             | `products.write`                   | yes   | yes   | -       |
| POST   | `/v1/products/{productId}/deactivate`           | `products.write`                   | yes   | yes   | -       |
| DELETE | `/v1/products/{productId}/image`                | `products.write`                   | yes   | yes   | -       |
| GET    | `/v1/products/{productId}/image`                | `products.read`                    | yes   | yes   | yes     |
| PUT    | `/v1/products/{productId}/image`                | `products.write`                   | yes   | yes   | -       |
| GET    | `/v1/products/{productId}/prices`               | `products.write`                   | yes   | yes   | -       |
| POST   | `/v1/products/{productId}/prices`               | `pricing.write`                    | yes   | yes   | -       |
| GET    | `/v1/products/by-barcode/{barcode}`             | `products.read`                    | yes   | yes   | yes     |
| POST   | `/v1/products/categories`                       | `products.write`                   | yes   | yes   | -       |
| POST   | `/v1/products/import`                           | `products.write` + `pricing.write` | yes   | yes   | -       |
| GET    | `/v1/products/options`                          | `products.read`                    | yes   | yes   | yes     |
| GET    | `/v1/purchases`                                 | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/purchases`                                 | `purchases.write`                  | yes   | yes   | -       |
| GET    | `/v1/purchases/{purchaseId}`                    | `purchases.write`                  | yes   | yes   | -       |
| GET    | `/v1/stock`                                     | `products.read`                    | yes   | yes   | yes     |
| POST   | `/v1/stock/adjustments`                         | `stock.adjust`                     | yes   | yes   | -       |
| GET    | `/v1/stock/alerts`                              | `stock.adjust`                     | yes   | yes   | -       |
| GET    | `/v1/stock/ledger`                              | `stock.adjust`                     | yes   | yes   | -       |
| POST   | `/v1/stock/rebuild`                             | `settings.manage`                  | yes   | yes   | -       |
| GET    | `/v1/stock/settings`                            | `settings.manage`                  | yes   | yes   | -       |
| PUT    | `/v1/stock/settings`                            | `settings.manage`                  | yes   | yes   | -       |
| PUT    | `/v1/stock/thresholds`                          | `stock.adjust`                     | yes   | yes   | -       |
| GET    | `/v1/stock/transfers`                           | `stock.transfer`                   | yes   | yes   | -       |
| POST   | `/v1/stock/transfers`                           | `stock.transfer`                   | yes   | yes   | -       |
| GET    | `/v1/stock/transfers/{transferId}`              | `stock.transfer`                   | yes   | yes   | -       |
| POST   | `/v1/stock/transfers/{transferId}/cancel`       | `stock.transfer`                   | yes   | yes   | -       |
| POST   | `/v1/stock/transfers/{transferId}/receive`      | `stock.transfer`                   | yes   | yes   | -       |
| GET    | `/v1/stock/verify`                              | `stock.adjust`                     | yes   | yes   | -       |
| POST   | `/v1/stock/write-offs`                          | `stock.adjust`                     | yes   | yes   | -       |
| GET    | `/v1/supplier-returns`                          | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/supplier-returns`                          | `purchases.write`                  | yes   | yes   | -       |
| GET    | `/v1/supplier-returns/{returnId}`               | `purchases.write`                  | yes   | yes   | -       |
| GET    | `/v1/suppliers`                                 | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/suppliers`                                 | `purchases.write`                  | yes   | yes   | -       |
| GET    | `/v1/suppliers/{supplierId}`                    | `purchases.write`                  | yes   | yes   | -       |
| PUT    | `/v1/suppliers/{supplierId}`                    | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/suppliers/{supplierId}/activate`           | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/suppliers/{supplierId}/deactivate`         | `purchases.write`                  | yes   | yes   | -       |
| POST   | `/v1/team/approvals/verify-pin`                 | `pos.sell`                         | yes   | yes   | yes     |
| GET    | `/v1/team/approvers`                            | `pos.sell`                         | yes   | yes   | yes     |
| GET    | `/v1/team/members`                              | `team.manage`                      | yes   | yes   | -       |
| POST   | `/v1/team/members`                              | `team.manage`                      | yes   | yes   | -       |
| GET    | `/v1/team/members/{memberId}`                   | `team.manage`                      | yes   | yes   | -       |
| PATCH  | `/v1/team/members/{memberId}`                   | `team.manage`                      | yes   | yes   | -       |
| POST   | `/v1/team/members/{memberId}/disable`           | `team.manage`                      | yes   | yes   | -       |
| POST   | `/v1/team/members/{memberId}/enable`            | `team.manage`                      | yes   | yes   | -       |
| POST   | `/v1/team/members/{memberId}/resend-invitation` | `team.manage`                      | yes   | yes   | -       |
| GET    | `/v1/team/options`                              | `team.manage`                      | yes   | yes   | -       |
| GET    | `/v1/team/roles`                                | `team.manage`                      | yes   | yes   | -       |
| POST   | `/v1/team/roles`                                | `team.manage`                      | yes   | yes   | -       |
| DELETE | `/v1/team/roles/{roleId}`                       | `team.manage`                      | yes   | yes   | -       |
| PATCH  | `/v1/team/roles/{roleId}`                       | `team.manage`                      | yes   | yes   | -       |
