import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n),
  digestStringAsync: async () => 'digest',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}))

import { normalizeBaseUrl, wsUrl } from '@/lib/auth'

describe('normalizeBaseUrl', () => {
  it('adds http:// and trims slashes', () => {
    expect(normalizeBaseUrl('  host:9119/  ')).toBe('http://host:9119')
    expect(normalizeBaseUrl('https://h/prefix/')).toBe('https://h/prefix')
  })

  it('drops a trailing /api so paths are appended once', () => {
    expect(normalizeBaseUrl('http://host:9119/api')).toBe('http://host:9119')
    expect(normalizeBaseUrl('http://host:9119/api/')).toBe('http://host:9119')
  })

  it('returns an empty string for empty input', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('wsUrl', () => {
  it('switches http to ws and encodes the query', () => {
    expect(wsUrl('http://host:9119', '/api/ws', { token: 'a b' })).toBe(
      'ws://host:9119/api/ws?token=a%20b',
    )
  })

  it('uses wss for https and omits the ? when there is no query', () => {
    expect(wsUrl('https://host', '/api/ws', {})).toBe('wss://host/api/ws')
  })
})
