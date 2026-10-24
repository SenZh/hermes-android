import { describe, expect, it } from 'vitest'

import { parseConnectLink } from '@/lib/links'

describe('parseConnectLink', () => {
  it('accepts a bare http(s) URL', () => {
    expect(parseConnectLink('http://100.69.133.94:9119')).toEqual({ url: 'http://100.69.133.94:9119' })
    expect(parseConnectLink('  https://example.com/hermes  ')).toEqual({ url: 'https://example.com/hermes' })
  })

  it('parses a hermes:// connect link', () => {
    const link = parseConnectLink(
      'hermes://connect?url=http%3A%2F%2F192.168.1.20%3A9119&name=Home&token=abc&user=me',
    )
    expect(link).toEqual({
      url: 'http://192.168.1.20:9119',
      name: 'Home',
      token: 'abc',
      username: 'me',
    })
  })

  it('keeps a token sent as a query parameter on a bare URL', () => {
    expect(parseConnectLink('http://host:9119/?token=abc')).toEqual({
      url: 'http://host:9119',
      token: 'abc',
    })
  })

  it('returns null for text that is not a link', () => {
    expect(parseConnectLink('not a link')).toBeNull()
    expect(parseConnectLink('')).toBeNull()
  })
})
