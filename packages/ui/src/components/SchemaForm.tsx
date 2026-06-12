import { useEffect, useRef, useState } from 'react';

/**
 * Renders an operator-friendly settings form from a FieldSchema tree
 * produced by @frontrangesystems/business-os-core's zodToFieldSchema(). Mirrors the discriminated
 * union over there — keeping the shapes copy-pasted here avoids a runtime
 * dep on core from the UI.
 *
 * The form holds its own internal state derived from the value prop. Every
 * change calls onChange with the new value. Validation is server-side — the
 * Zod schema on the API endpoint rejects invalid input and the page surfaces
 * those errors next to the form.
 */

export type FieldSchema =
  | StringField
  | NumberField
  | BooleanField
  | EnumField
  | ObjectField
  | StringArrayField
  | UnknownField;

export interface StringField {
  type: 'string';
  optional?: boolean;
  default?: string;
  description?: string;
  multiline?: boolean;
  secret?: boolean;
}
export interface NumberField {
  type: 'number';
  optional?: boolean;
  default?: number;
  description?: string;
  int?: boolean;
  min?: number;
  max?: number;
}
export interface BooleanField {
  type: 'boolean';
  optional?: boolean;
  default?: boolean;
  description?: string;
}
export interface EnumField {
  type: 'enum';
  values: string[];
  optional?: boolean;
  default?: string;
  description?: string;
}
export interface ObjectField {
  type: 'object';
  fields: Record<string, FieldSchema>;
  optional?: boolean;
  description?: string;
}
export interface StringArrayField {
  type: 'stringArray';
  optional?: boolean;
  default?: string[];
  description?: string;
}
export interface UnknownField {
  type: 'unknown';
  reason: string;
}

interface FormProps {
  schema: FieldSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  /**
   * Extends the no-autofill treatment to ALL string fields in this form,
   * not just `secret` ones. Use for credentials forms where the username/
   * identifier next to the password also shouldn't be browser-filled (e.g.
   * IMAP `user`). Secret fields always get this treatment regardless —
   * Login and PasswordReset are the only password forms in the app where
   * autofill is wanted, and those don't go through SchemaForm.
   */
  noAutofill?: boolean;
}

/**
 * Acronyms that should stay all-uppercase after `humanLabel` title-cases.
 * Add new ones as agents introduce them. Case-insensitive match.
 */
const KNOWN_ACRONYMS = new Set([
  'VIP',
  'URL',
  'URI',
  'API',
  'ID',
  'IMAP',
  'SMTP',
  'SSL',
  'TLS',
  'OAUTH',
  'OAUTH2',
  'HTTP',
  'HTTPS',
  'JSON',
  'CSV',
  'CRM',
  'LLM',
  'PDF',
  'UUID',
  'AI',
  'UI',
  'UX',
]);

function humanLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((w) => {
      if (!w) return w;
      const upper = w.toUpperCase();
      if (KNOWN_ACRONYMS.has(upper)) return upper;
      return w[0]!.toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function defaultFor(schema: FieldSchema): unknown {
  // For optional fields with no default, return undefined so the parent
  // object-builder can omit the key entirely. Otherwise the server sees
  // `''` for an optional `z.string().min(1).optional()` and rejects it as
  // an empty string — the operator gets a "must contain at least..."
  // toast despite never having touched the field.
  const isOptional = schema.type !== 'unknown' && (schema as { optional?: boolean }).optional;
  switch (schema.type) {
    case 'string':
      if (schema.default !== undefined) return schema.default;
      return isOptional ? undefined : '';
    case 'number':
      if (schema.default !== undefined) return schema.default;
      return isOptional ? undefined : '';
    case 'boolean':
      if (schema.default !== undefined) return schema.default;
      return isOptional ? undefined : false;
    case 'enum':
      if (schema.default !== undefined) return schema.default;
      return isOptional ? undefined : (schema.values[0] ?? '');
    case 'stringArray':
      if (schema.default !== undefined) return schema.default;
      return isOptional ? undefined : [];
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.fields)) {
        const d = defaultFor(v);
        const optional = v.type !== 'unknown' && (v as { optional?: boolean }).optional;
        if (!optional || d !== undefined) obj[k] = d;
      }
      return obj;
    }
    case 'unknown':
      return undefined;
  }
}

export function SchemaForm(props: FormProps): JSX.Element {
  return <FieldRenderer {...props} path="" />;
}

interface FieldProps extends FormProps {
  path: string;
  label?: string;
}

const NO_AUTOFILL_PROPS = {
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  // Vendor-specific opt-outs — browsers and password managers each pick a
  // different signal. Setting all of them is the only way to reliably stop
  // autofill on a non-login form.
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

function FieldRenderer(props: FieldProps): JSX.Element {
  const { schema, value, onChange, path, label, noAutofill } = props;

  switch (schema.type) {
    case 'object': {
      const obj = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) || {};
      return (
        <div
          className={
            path === ''
              ? 'space-y-5'
              : 'space-y-4 border-l-2 border-ink-100 pl-4 dark:border-ink-800'
          }
        >
          {path !== '' && label && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
              {label}
            </div>
          )}
          {Object.entries(schema.fields).map(([key, fieldSchema]) => (
            <FieldRenderer
              key={key}
              schema={fieldSchema}
              value={obj[key]}
              onChange={(next) => {
                const updated = { ...obj, [key]: next };
                if (next === undefined || next === '') {
                  // Drop undefined / empty optional fields so the server applies its default.
                  const isOptional =
                    fieldSchema.type !== 'unknown' && (fieldSchema as { optional?: boolean }).optional;
                  if (isOptional) delete updated[key];
                }
                onChange(updated);
              }}
              path={path === '' ? key : `${path}.${key}`}
              label={humanLabel(key)}
              noAutofill={noAutofill}
            />
          ))}
        </div>
      );
    }

    case 'string': {
      const v = (value as string | undefined) ?? '';
      return (
        <div>
          <label className="label">{label}</label>
          {schema.multiline ? (
            <textarea
              className="input"
              rows={4}
              value={v}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.default}
              {...(noAutofill ? NO_AUTOFILL_PROPS : {})}
            />
          ) : (
            <NoAutofillInput
              schema={schema}
              value={v}
              onChange={onChange}
              path={path}
              // Secret fields ALWAYS get the no-autofill treatment — Login
              // and PasswordReset are the only password forms in the app
              // where browser autofill is legitimate, and those don't go
              // through SchemaForm. `noAutofill` on the form extends the
              // same defense to the secret field's non-secret siblings
              // (e.g. the IMAP `user` next to `password`).
              disable={!!schema.secret || !!noAutofill}
            />
          )}
          {schema.description && <Help>{schema.description}</Help>}
        </div>
      );
    }

    case 'number': {
      const v = (value as number | string | undefined);
      return (
        <div>
          <label className="label">{label}</label>
          <input
            type="number"
            className="input"
            value={v ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') return onChange(undefined);
              const num = schema.int ? parseInt(raw, 10) : parseFloat(raw);
              onChange(Number.isNaN(num) ? raw : num);
            }}
            placeholder={schema.default !== undefined ? String(schema.default) : ''}
            min={schema.min}
            max={schema.max}
            step={schema.int ? 1 : 'any'}
          />
          {schema.description && <Help>{schema.description}</Help>}
        </div>
      );
    }

    case 'boolean': {
      const v = Boolean(value ?? schema.default ?? false);
      return (
        <div className="flex items-start gap-2.5">
          <input
            id={path}
            type="checkbox"
            checked={v}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent dark:border-ink-600 dark:bg-ink-900"
          />
          <div>
            <label
              htmlFor={path}
              className="cursor-pointer text-sm font-medium text-ink-900 dark:text-ink-100"
            >
              {label}
            </label>
            {schema.description && (
              <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                {schema.description}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'enum': {
      const v = (value as string | undefined) ?? schema.default ?? '';
      // Render small enums as a radio group — discoverable at a glance.
      // Larger sets fall back to a select.
      if (schema.values.length <= 4) {
        return (
          <fieldset>
            <legend className="label">{label}</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {schema.values.map((opt) => {
                const selected = opt === v;
                return (
                  <label
                    key={opt}
                    className={
                      'cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                      (selected
                        ? 'border-accent bg-accent/10 text-accent dark:border-accent dark:bg-accent/20'
                        : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800')
                    }
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`enum-${path}`}
                      value={opt}
                      checked={selected}
                      onChange={() => onChange(opt)}
                    />
                    {humanLabel(opt)}
                  </label>
                );
              })}
            </div>
            {schema.description && <Help>{schema.description}</Help>}
          </fieldset>
        );
      }
      return (
        <div>
          <label className="label">{label}</label>
          <select
            className="input"
            value={v}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            {schema.optional && <option value="">— (use default)</option>}
            {schema.values.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {schema.description && <Help>{schema.description}</Help>}
        </div>
      );
    }

    case 'stringArray': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const text = arr.join('\n');
      return (
        <div>
          <label className="label">{label}</label>
          <textarea
            className="input"
            rows={3}
            value={text}
            onChange={(e) => {
              const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
              onChange(lines.length === 0 ? undefined : lines);
            }}
            placeholder="One per line"
          />
          {schema.description && <Help>{schema.description}</Help>}
        </div>
      );
    }

    case 'unknown':
      return (
        <UnknownEditor
          value={value}
          onChange={onChange}
          label={label}
          reason={schema.reason}
        />
      );
  }
}

/**
 * String input that actively defends against browser autofill and password
 * managers. Three layers, all needed because each tool ignores some signals:
 *
 *   1. `autocomplete="new-password"` for secret fields — the most reliable
 *      Chrome opt-out (Chrome ignores `off` on login-shaped forms).
 *   2. The full set of `data-*-ignore` attributes for 1Password, LastPass,
 *      Bitwarden.
 *   3. A mount-time ref that re-clears the DOM value if Chrome got there
 *      first. React's controlled-value pass can lose the race to autofill;
 *      forcing the DOM back to '' once on mount wins it back.
 */
function NoAutofillInput(props: {
  schema: StringField;
  value: string;
  onChange: (v: unknown) => void;
  path: string;
  disable: boolean;
}): JSX.Element {
  const { schema, value, onChange, path, disable } = props;
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!disable) return;
    const el = ref.current;
    if (el && el.value && !value) {
      // Chrome / password manager beat React to the DOM. Clear it.
      el.value = '';
    }
  }, [disable, value]);
  return (
    <input
      ref={ref}
      type={schema.secret ? 'password' : 'text'}
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={schema.default}
      {...(disable
        ? {
            ...NO_AUTOFILL_PROPS,
            // 'new-password' is the most reliable Chrome opt-out — `off` is
            // ignored on login-shaped forms.
            autoComplete: schema.secret ? 'new-password' : 'off',
            name: `f-${path}`,
          }
        : {})}
    />
  );
}

function Help({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mt-1 text-xs text-ink-500 dark:text-ink-400">{children}</div>;
}

function UnknownEditor(props: {
  value: unknown;
  onChange: (v: unknown) => void;
  label?: string;
  reason: string;
}): JSX.Element {
  const [text, setText] = useState(JSON.stringify(props.value ?? null, null, 2));
  useEffect(() => {
    setText(JSON.stringify(props.value ?? null, null, 2));
  }, [props.value]);
  return (
    <div>
      {props.label && <label className="label">{props.label}</label>}
      <textarea
        className="input-mono"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            props.onChange(JSON.parse(e.target.value));
          } catch {
            // ignore until JSON valid
          }
        }}
      />
      <Help>JSON editor — schema node unsupported ({props.reason}).</Help>
    </div>
  );
}
