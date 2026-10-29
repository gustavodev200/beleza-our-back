/** Mantém só os dígitos de um CPF/CNPJ digitado com ou sem máscara. */
export function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

function checkDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const first = checkDigit(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === d[9] && second === d[10];
}

export function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const first = checkDigit(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === d[12] && second === d[13];
}

/** Devolve só os dígitos se for CPF ou CNPJ válido; senão `null`. */
export function normalizeCpfCnpj(raw: string): string | null {
  const digits = onlyDigits(raw);
  if (digits.length === 11) return isValidCpf(digits) ? digits : null;
  if (digits.length === 14) return isValidCnpj(digits) ? digits : null;
  return null;
}
