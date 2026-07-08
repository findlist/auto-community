import { useState, useCallback, useMemo } from "react";

interface FieldConfig {
  value: string;
  rules: ((value: string) => string | null)[];
}

interface UseFormValidationReturn {
  errors: Record<string, string | null>;
  touched: Record<string, boolean>;
  validateField: (name: string) => boolean;
  validateAll: () => boolean;
  getFieldError: (name: string) => string | null;
  hasErrors: () => boolean;
  setTouched: (name: string) => void;
  reset: () => void;
}

export function useFormValidation(fields: Record<string, FieldConfig>): UseFormValidationReturn {
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [touched, setTouchedState] = useState<Record<string, boolean>>({});

  const validateField = useCallback((name: string): boolean => {
    const field = fields[name];
    if (!field) return true;

    let error: string | null = null;
    for (const rule of field.rules) {
      error = rule(field.value);
      if (error) break;
    }

    setErrors(prev => ({ ...prev, [name]: error }));
    return !error;
  }, [fields]);

  const validateAll = useCallback((): boolean => {
    const newErrors: Record<string, string | null> = {};
    let isValid = true;

    for (const name of Object.keys(fields)) {
      const field = fields[name];
      if (!field) continue;
      let error: string | null = null;
      for (const rule of field.rules) {
        error = rule(field.value);
        if (error) {
          isValid = false;
          break;
        }
      }
      newErrors[name] = error;
    }

    setErrors(newErrors);
    // 标记所有字段为已触摸
    setTouchedState(prev => {
      const allTouched = { ...prev };
      for (const name of Object.keys(fields)) {
        allTouched[name] = true;
      }
      return allTouched;
    });

    return isValid;
  }, [fields]);

  const getFieldError = useCallback((name: string): string | null => {
    if (!touched[name]) return null;
    return errors[name] || null;
  }, [errors, touched]);

  const hasErrors = useCallback((): boolean => {
    return Object.values(errors).some(error => error !== null);
  }, [errors]);

  const setTouched = useCallback((name: string) => {
    setTouchedState(prev => ({ ...prev, [name]: true }));
    validateField(name);
  }, [validateField]);

  const reset = useCallback(() => {
    setErrors({});
    setTouchedState({});
  }, []);

  return useMemo(() => ({
    errors,
    touched,
    validateField,
    validateAll,
    getFieldError,
    hasErrors,
    setTouched,
    reset,
  }), [errors, touched, validateField, validateAll, getFieldError, hasErrors, setTouched, reset]);
}