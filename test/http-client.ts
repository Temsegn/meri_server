/** Minimal cookie-keeping HTTP client for the e2e tests. */
export const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api/v1`

export class Client {
  cookies = new Map<string, string>()

  async call(method: string, path: string, body?: unknown, raw?: FormData) {
    const res = await fetch(`${API}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    })
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';')
      const [name, value] = pair.split('=')
      if (value) this.cookies.set(name, value)
      else this.cookies.delete(name)
    }
    const text = await res.text()
    const json = res.headers.get('content-type')?.includes('application/json')
    return { status: res.status, headers: res.headers, data: json && text ? JSON.parse(text) : null }
  }
}
