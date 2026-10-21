export default async function globalTeardown(): Promise<void> {
  await Promise.all((globalThis.__CONTAINERS__ ?? []).map((c) => c.stop()));
}
