import { useEffect, useState } from 'react';

/**
 * Renders an operator-friendly settings form from a FieldSchema tree
 * produced by @business-os/core's zodToFieldSchema(). Mirrors the discriminated
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
}

function humanLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function defaultFor(schema: FieldSchema): unknown {
  switch (schema.type) {
    case 'string':
      return schema.default ?? '';
    case 'number':
      return schema.default ?? '';
    case 'boolean':
      return schema.default ?? false;
    case 'enum':
      return schema.default ?? schema.values[0] ?? '';
    case 'stringArray':
      return schema.default ?? [];
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

function FieldRenderer(props: FieldProps): JSX.Element {
  const { schema, value, onChange, path, label } = props;

  switch (schema.type) {
    case 'object': {
      const obj = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) || {};
      return (
        <div className={path === '' ? 'space-y-4' : 'space-y-3 rounded border border-ink-200 bg-ink-50 p-3 dark:border-ink-700 dark:bg-ink-900'}>
          {path !== '' && label && (
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
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
            />
          ) : (
            <input
              type={schema.secret ? 'password' : 'text'}
              className="input"
              value={v}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.default}
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
        <div className="flex items-start gap-2">
          <input
            id={path}
            type="checkbox"
            checked={v}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent dark:border-ink-600"
          />
          <div>
            <label htmlFor={path} className="text-sm font-medium text-ink-900 dark:text-ink-100">
              {label}
            </label>
            {schema.description && (
              <div className="text-xs text-ink-500 dark:text-ink-400">{schema.description}</div>
            )}
          </div>
        </div>
      );
    }

    case 'enum': {
      const v = (value as string | undefined) ?? schema.default ?? '';
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
