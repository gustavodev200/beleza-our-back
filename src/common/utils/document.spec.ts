import { normalizeCpfCnpj } from './document';

describe('document', () => {
  it('aceita CPF válido com ou sem máscara', () => {
    expect(normalizeCpfCnpj('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpfCnpj('52998224725')).toBe('52998224725');
  });

  it('aceita CNPJ válido com ou sem máscara', () => {
    expect(normalizeCpfCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeCpfCnpj('11222333000181')).toBe('11222333000181');
  });

  it('recusa dígito verificador errado, sequência repetida e tamanho inválido', () => {
    expect(normalizeCpfCnpj('529.982.247-24')).toBeNull();
    expect(normalizeCpfCnpj('111.111.111-11')).toBeNull();
    expect(normalizeCpfCnpj('11.222.333/0001-82')).toBeNull();
    expect(normalizeCpfCnpj('00000000000000')).toBeNull();
    expect(normalizeCpfCnpj('123')).toBeNull();
    expect(normalizeCpfCnpj('')).toBeNull();
  });
});
