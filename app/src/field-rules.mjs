import { fail } from './errors.mjs';
import { timestampValue } from './timestamps.mjs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '';
const ruleTypes = new Set(['string', 'array', 'number', 'integer', 'boolean', 'object', 'date', 'timestamp']);
const itemTypes = new Set(['string', 'number', 'integer', 'boolean', 'object', 'date', 'timestamp']);

function invalidConfig(path, message) {
  fail('INVALID_CONFIG', `${path}: ${message}`);
}

function validateRule(rule, path, statuses) {
  if (!object(rule)) invalidConfig(path, 'field rule must be an object');
  const allowed = ['type', 'required', 'required_for_statuses', 'non_empty', 'items', 'non_empty_items', 'min_items'];
  for (const key of Object.keys(rule)) if (!allowed.includes(key)) invalidConfig(path, `unsupported field rule key ${key}`);
  if (rule.type !== undefined && !ruleTypes.has(rule.type)) {
    invalidConfig(path, `type must be one of ${[...ruleTypes].join(', ')}`);
  }
  if (rule.required !== undefined && typeof rule.required !== 'boolean') invalidConfig(path, 'required must be a boolean');
  if (rule.non_empty !== undefined && typeof rule.non_empty !== 'boolean') invalidConfig(path, 'non_empty must be a boolean');
  if (rule.non_empty_items !== undefined && typeof rule.non_empty_items !== 'boolean') {
    invalidConfig(path, 'non_empty_items must be a boolean');
  }
  if (rule.items !== undefined && !itemTypes.has(rule.items)) {
    invalidConfig(path, `items must be one of ${[...itemTypes].join(', ')}`);
  }
  if (rule.min_items !== undefined && (!Number.isSafeInteger(rule.min_items) || rule.min_items < 0)) {
    invalidConfig(path, 'min_items must be a non-negative safe integer');
  }
  if (rule.required_for_statuses !== undefined) {
    if (!Array.isArray(rule.required_for_statuses) || !rule.required_for_statuses.every(text)) {
      invalidConfig(path, 'required_for_statuses must be an array of non-empty strings');
    }
    for (const status of rule.required_for_statuses) {
      if (!statuses.has(status)) invalidConfig(path, `required_for_statuses references undeclared status ${status}`);
    }
  }
  if ((rule.items !== undefined || rule.non_empty_items !== undefined || rule.min_items !== undefined)
    && rule.type !== undefined && rule.type !== 'array') {
    invalidConfig(path, 'items, non_empty_items and min_items require type array');
  }
}

export function validateFieldRules(rules, path, statuses) {
  if (rules === undefined) return;
  if (!object(rules)) invalidConfig(path, 'fields must be an object');
  for (const [field, rule] of Object.entries(rules)) {
    if (!text(field)) invalidConfig(path, 'field names must be non-empty strings');
    validateRule(rule, `${path}.fields.${field}`, statuses);
  }
}

function present(task, field, label, invalid) {
  if (!Object.hasOwn(task, field) || task[field] === null || task[field] === undefined) {
    invalid(field, `is required by ${label}`);
    return false;
  }
  return true;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function checkType(value, type, label, invalid) {
  if (type === undefined) return;
  if (type === 'string' && typeof value !== 'string') invalid(label, 'must be a string');
  else if (type === 'array' && !Array.isArray(value)) invalid(label, 'must be an array');
  else if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) invalid(label, 'must be a finite number');
  else if (type === 'integer' && !Number.isSafeInteger(value)) invalid(label, 'must be a safe integer');
  else if (type === 'boolean' && typeof value !== 'boolean') invalid(label, 'must be a boolean');
  else if (type === 'object' && !object(value)) invalid(label, 'must be an object');
  else if (type === 'date' && !validDate(value)) invalid(label, 'must be a valid date string');
  else if (type === 'timestamp') timestampValue(value, 'INVALID_STORE', label);
}

function validateItems(values, type, field, invalid, nonEmpty) {
  if (type === undefined) return;
  values.forEach((value, index) => {
    const label = `${field}[${index}]`;
    checkType(value, type, label, invalid);
    if (nonEmpty && typeof value === 'string' && !text(value)) invalid(label, 'must be a non-empty string');
  });
}

export function applyFieldRules(task, rules, status, label, invalid) {
  for (const [field, rule] of Object.entries(rules ?? {})) {
    const required = rule.required === true || (rule.required_for_statuses ?? []).includes(status);
    if (required && !present(task, field, label, invalid)) continue;
    if (!Object.hasOwn(task, field) || task[field] === undefined || task[field] === null) continue;
    const value = task[field];
    checkType(value, rule.type, field, invalid);
    if (rule.non_empty === true) {
      if (typeof value === 'string' && !text(value)) invalid(field, 'must be a non-empty string');
      if (Array.isArray(value) && value.length === 0) invalid(field, 'must be a non-empty array');
    }
    if (Array.isArray(value)) {
      if (rule.min_items !== undefined && value.length < rule.min_items) {
        invalid(field, `must contain at least ${rule.min_items} item${rule.min_items === 1 ? '' : 's'}`);
      }
      validateItems(value, rule.items, field, invalid, rule.non_empty_items === true);
    }
  }
}
