export default async function globalTeardown() {
  // Connection pools are closed per suite via afterAll hooks.
  // Intentionally left as a no-op.
}
