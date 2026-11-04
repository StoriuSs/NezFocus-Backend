import { describeRotation, RotationReport } from './rotate-encryption-key'

const report = (overrides: Partial<RotationReport> = {}): RotationReport => ({
    secrets: 3,
    resealed: 3,
    unreadable: [],
    codesOnPreviousKey: 0,
    codesOfUnnamedKey: 0,
    codesOnUnknownKey: 0,
    ...overrides
})

describe('pnpm auth:rotate-key', () => {
    // Removing the previous key too early locks people out of two-step sign-in.
    it('says the previous key can go only once nothing needs it', () => {
        expect(describeRotation(report(), true).join('\n')).toContain('Nothing needs AUTH_ENCRYPTION_KEY_PREVIOUS')
        for (const needing of [
            { codesOnPreviousKey: 1 },
            { codesOfUnnamedKey: 2 },
            { unreadable: [{ userId: 'u1', email: null, reason: 'unknown-key' as const }] }
        ]) {
            expect(describeRotation(report(needing), true).join('\n')).not.toContain('Nothing needs')
        }
    })
})
