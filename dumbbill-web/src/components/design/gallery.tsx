'use client';

/**
 * The design-system gallery: every component in every state, in the current theme, on one page.
 * Open it at /design (switch the theme with the toggle in the header).
 *
 * What it is for:
 *   - designers and reviewers look at the real components instead of screenshots
 *   - the browser tests run the accessibility checker and keyboard checks against it
 *   - developers copy the usage from here
 *
 * It is an internal tool, not a product screen, so its text is written directly in English instead of going through
 * the translation files. It is switched off on the live site (NEXT_PUBLIC_DESIGN_GALLERY=false).
 */
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogClose,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  MoneyText,
  PasswordInput,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  QrCode,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
  type DataColumn,
} from '@/components/ui';
import { CloseIcon } from '@/components/ui/icons';
import { COLOR_ROLES } from '@/lib/design/token-names';

/** Sample records for the table demos. Prices are whole paise. */
interface SampleProduct {
  id: string;
  name: string;
  brand: string;
  sku: string;
  stock: number;
  pricePaise: number;
  expiresInDays: number;
}

const PRODUCTS: SampleProduct[] = [
  {
    id: '1',
    name: 'Gold Standard Whey 2 lb',
    brand: 'Optimum Nutrition',
    sku: 'ON-GSW-2LB-DRC',
    stock: 14,
    pricePaise: 489_900,
    expiresInDays: 210,
  },
  {
    id: '2',
    name: 'Raw Whey 1 kg',
    brand: 'MuscleBlaze',
    sku: 'MB-RW-1KG-CHO',
    stock: 3,
    pricePaise: 279_900,
    expiresInDays: 25,
  },
  {
    id: '3',
    name: 'Creatine Monohydrate 250 g',
    brand: 'Boldfit',
    sku: 'BF-CRE-250',
    stock: 42,
    pricePaise: 89_900,
    expiresInDays: 400,
  },
  {
    id: '4',
    name: 'Gym Shaker 700 ml',
    brand: 'Boldfit',
    sku: 'BF-SHK-700-BLK',
    stock: 0,
    pricePaise: 34_900,
    expiresInDays: 9_999,
  },
];

const COLUMNS: DataColumn<SampleProduct>[] = [
  {
    id: 'name',
    header: 'Product',
    value: (p) => p.name,
    sortable: true,
    cell: (p) => <span className="font-medium">{p.name}</span>,
  },
  { id: 'brand', header: 'Brand', value: (p) => p.brand, sortable: true },
  { id: 'sku', header: 'SKU', value: (p) => p.sku, mono: true },
  {
    id: 'stock',
    header: 'Stock',
    value: (p) => p.stock,
    align: 'right',
    mono: true,
    sortable: true,
  },
  {
    id: 'expiry',
    header: 'Expiry',
    value: (p) => p.expiresInDays,
    sortable: true,
    cell: (p) =>
      p.expiresInDays > 365 ? (
        <span className="text-muted">Not expiring soon</span>
      ) : p.expiresInDays > 60 ? (
        <span>{p.expiresInDays} days</span>
      ) : (
        <Badge variant="warning">Expires in {p.expiresInDays} days</Badge>
      ),
  },
  {
    id: 'price',
    header: 'Price',
    value: (p) => p.pricePaise,
    align: 'right',
    sortable: true,
    cell: (p) => <MoneyText paise={p.pricePaise} />,
  },
];

// Written out one by one so Tailwind can see every class name (it cannot find names built from strings).
const TYPE_SCALE: Array<{ name: string; px: number; className: string }> = [
  { name: 'micro', px: 11, className: 'text-micro' },
  { name: 'caption', px: 12, className: 'text-caption' },
  { name: 'small', px: 14, className: 'text-small' },
  { name: 'body', px: 16, className: 'text-body' },
  { name: 'title', px: 20, className: 'text-title' },
  { name: 'heading', px: 28, className: 'text-heading' },
  { name: 'display', px: 40, className: 'text-display' },
  { name: 'hero', px: 64, className: 'text-hero' },
];

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t-2 border-rule pt-6">
      <div>
        <h2 id={id} className="font-display text-heading font-bold tracking-wide uppercase">
          {title}
        </h2>
        {note && <p className="mt-1 max-w-prose text-small text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ToastButtons() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          toast({
            title: 'Bill saved',
            description: 'Invoice DB-0042 for ₹6,694.00',
            tone: 'success',
          })
        }
      >
        Success toast
      </Button>
      <Button
        onClick={() =>
          toast({
            title: 'Printer not found',
            description: 'Check the cable, then try again.',
            tone: 'danger',
          })
        }
      >
        Error toast
      </Button>
      <Button onClick={() => toast({ title: 'Price updated' })}>Plain toast</Button>
    </div>
  );
}

export function Gallery() {
  const [category, setCategory] = useState<string>();
  const [selectAll, setSelectAll] = useState<boolean | 'indeterminate'>('indeterminate');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="font-display text-display font-bold tracking-wide uppercase">
          Design system
        </h1>
        <p className="mt-1 max-w-prose text-body text-muted">
          Every component and state, in the current theme. Use the theme switch above to compare
          dark (Iron Ledger) and light (Quiet Ledger).
        </p>
      </header>

      <Section
        id="colour"
        title="Colour tokens"
        note="The only colours that exist. Components use them by name; the values change with the theme."
      >
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLOR_ROLES.map((color) => (
            <li key={color.role} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 size-8 shrink-0 rounded-control border border-line"
                style={{ backgroundColor: `var(${color.cssVar})` }}
              />
              <span className="text-small">
                <span className="block font-mono font-medium">{color.role}</span>
                <span className="block text-caption text-muted">{color.use}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="type"
        title="Type"
        note="Inter Tight for interface text, Barlow Condensed for totals and headings, JetBrains Mono for prices and codes."
      >
        <div className="flex flex-col gap-2">
          {TYPE_SCALE.map((step) => (
            <div key={step.name} className="flex items-baseline gap-4 border-b border-line pb-2">
              <span className="w-28 shrink-0 font-mono text-caption text-muted">
                {step.name} {step.px}
              </span>
              <span
                className={`${step.className} ${step.px >= 28 ? 'font-display font-bold tracking-wide uppercase' : ''}`}
              >
                Whey Isolate 2 kg
              </span>
            </div>
          ))}
          <p className="font-mono text-small">ON-GSW-2LB-DRC · 8901234567890 · ₹1,24,500.00</p>
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        note="Primary once per area. Large (48 px) is for the till."
      >
        <div className="flex flex-col gap-4">
          {(['primary', 'secondary', 'danger', 'ghost'] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <span className="w-24 font-mono text-caption text-muted">{variant}</span>
              <Button variant={variant} size="sm">
                Save
              </Button>
              <Button variant={variant}>Save</Button>
              <Button variant={variant} size="lg">
                Save
              </Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} loading>
                Saving
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 font-mono text-caption text-muted">icon</span>
            <IconButton label="Close preview" size="sm">
              <CloseIcon className="size-4" />
            </IconButton>
            <IconButton label="Close preview">
              <CloseIcon />
            </IconButton>
            <IconButton label="Close preview" variant="secondary">
              <CloseIcon />
            </IconButton>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-24 font-mono text-caption text-muted">shortcut</span>
            <Button variant="primary" size="lg">
              Take payment <Kbd onAccent>F9</Kbd>
            </Button>
            <Button>
              Search <Kbd>F2</Kbd>
            </Button>
          </div>
        </div>
      </Section>

      <Section
        id="forms"
        title="Form controls"
        note="Labels are tied to their controls, errors are announced, and edges meet the 3:1 contrast rule."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Product name" hint="As printed on the pack" required>
            <Input placeholder="Gold Standard Whey 2 lb" />
          </Field>
          <Field label="Barcode" error="This barcode is already used by Raw Whey 1 kg.">
            <Input defaultValue="8901234567890" />
          </Field>
          <Field
            label="Password"
            hint="At least 10 characters. A few unrelated words work well."
            required
          >
            <PasswordInput
              showLabel="Show password"
              hideLabel="Hide password"
              autoComplete="new-password"
              defaultValue="violet harbour 4 lantern"
            />
          </Field>
          <Field label="Supplier (disabled)">
            <Input disabled defaultValue="Sharma Nutrition Traders" />
          </Field>
          <Field label="Category" hint="Decides the default GST rate">
            <Select
              value={category}
              onValueChange={setCategory}
              placeholder="Choose a category"
              options={[
                { value: 'protein', label: 'Protein and whey' },
                { value: 'performance', label: 'Performance' },
                { value: 'vitamins', label: 'Vitamins and wellness' },
                { value: 'accessories', label: 'Accessories', disabled: true },
              ]}
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-small font-medium">Checkbox states</legend>
            <Checkbox
              label="Select all products"
              checked={selectAll}
              onCheckedChange={(value) => setSelectAll(value === true)}
            />
            <Checkbox
              label="Track expiry dates"
              description="Alerts 60 days before a batch expires"
              defaultChecked
            />
            <Checkbox label="Allow negative stock" disabled />
            <Checkbox label="I have counted the cash drawer" invalid />
          </fieldset>
        </div>
      </Section>

      <Section
        id="alerts"
        title="Alerts"
        note="Messages that stay where the person is looking. Meaning is in the title, never the edge colour alone. Danger and warning are announced at once."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Alert tone="info" title="Check your inbox">
            We sent a link to ravi@fitfuel.in. It works for 24 hours.
          </Alert>
          <Alert tone="success" title="Password changed">
            You were signed out on your other devices.
          </Alert>
          <Alert tone="warning" title="Trial ends in 3 days">
            Choose a plan to keep billing without interruption.
          </Alert>
          <Alert tone="danger" title="Cannot sign in">
            The email or password is not correct.
          </Alert>
        </div>
      </Section>

      <Section id="badges" title="Badges" note="Meaning is in the words, never the colour alone.">
        <div className="flex flex-wrap gap-2">
          <Badge>In stock</Badge>
          <Badge variant="accent">New</Badge>
          <Badge variant="success">Paid</Badge>
          <Badge variant="danger">Out of stock</Badge>
          <Badge variant="warning">Expires in 12 days</Badge>
        </div>
      </Section>

      <Section
        id="money"
        title="Money"
        note="Whole paise in, Indian grouping out. Negative amounts show a minus sign and the danger colour."
      >
        <div className="flex flex-wrap items-baseline gap-8">
          <MoneyText paise={12_450_000} />
          <MoneyText paise={-35_230} />
          <MoneyText paise={669_400} size="total" trimZeroPaise />
          <MoneyText paise={669_430} size="total" />
          <MoneyText paise={669_400} size="hero" trimZeroPaise />
        </div>
      </Section>

      <Section id="tabs" title="Tabs" note="Arrow keys move between tabs.">
        <Tabs defaultValue="details">
          <TabsList aria-label="Product views">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="history">Price history</TabsTrigger>
          </TabsList>
          <TabsContent value="details">Name, brand, HSN code and GST rate.</TabsContent>
          <TabsContent value="stock">Quantity on hand in each branch.</TabsContent>
          <TabsContent value="history">Every price change, who made it and why.</TabsContent>
        </Tabs>
      </Section>

      <Section
        id="table"
        title="Table"
        note="Sortable columns are buttons. Rows are compact, the header stays visible, numbers line up."
      >
        <DataTable
          caption="Products in this branch"
          columns={COLUMNS}
          rows={PRODUCTS}
          getRowId={(p) => p.id}
        />
        <DataTable
          caption="Products (loading)"
          columns={COLUMNS}
          rows={[]}
          getRowId={(p: SampleProduct) => p.id}
          loading
        />
        <DataTable
          caption="Products (empty)"
          columns={COLUMNS}
          rows={[]}
          getRowId={(p: SampleProduct) => p.id}
          empty={
            <EmptyState
              headingLevel={3}
              title="No products yet"
              description="Add your first product to start billing."
              action={<Button variant="primary">Add product</Button>}
            />
          }
        />
      </Section>

      <Section
        id="qr"
        title="QR code"
        note="Always dark squares on a light ground, in both themes, so phone cameras can read it. Drawn in the browser: the text never leaves the page."
      >
        <QrCode
          value="otpauth://totp/Dumbbill:ravi%40fitfuel.in?secret=JBSWY3DPEHPK3PXP&issuer=Dumbbill"
          label="Example QR code"
        />
      </Section>

      <Section id="empty" title="Empty state and skeleton">
        <div className="grid gap-6 sm:grid-cols-2">
          <EmptyState
            headingLevel={3}
            title="No suppliers yet"
            description="Suppliers appear here once you record a purchase."
          />
          <div aria-busy="true" className="flex flex-col gap-3 rounded-card border border-line p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </Section>

      <Section
        id="overlays"
        title="Dialog, popover and toast"
        note="Focus is trapped in a dialog and returns to its button. Escape closes any of them."
      >
        <div className="flex flex-wrap gap-3">
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            trigger={<Button variant="danger">Cancel bill</Button>}
            title="Cancel this bill?"
            description="Invoice DB-0042 will be cancelled and the stock returned. This is recorded in the audit log."
            footer={
              <>
                <DialogClose asChild>
                  <Button>Keep bill</Button>
                </DialogClose>
                <Button
                  variant="danger"
                  loading={saving}
                  onClick={() => {
                    setSaving(true);
                    setTimeout(() => {
                      setSaving(false);
                      setDialogOpen(false);
                    }, 600);
                  }}
                >
                  Cancel bill
                </Button>
              </>
            }
          >
            <Field label="Reason" required>
              <Input placeholder="For example: customer changed their mind" />
            </Field>
          </Dialog>

          <Popover>
            <PopoverTrigger asChild>
              <Button>Discount</Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Discount">
              <div className="flex flex-col gap-3">
                <Field label="Percentage" hint="Your limit is 5%">
                  <Input inputMode="decimal" defaultValue="5" />
                </Field>
                <PopoverClose asChild>
                  <Button variant="primary">Apply discount</Button>
                </PopoverClose>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <ToastButtons />
      </Section>
    </div>
  );
}
