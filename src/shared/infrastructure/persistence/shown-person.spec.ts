import { hiddenSql, shownSql } from './shown-person'

describe('shownSql (D-182)', () => {
    it('reads a column as null for a hidden account, of the alias given', () => {
        expect(shownSql('u', 'displayName').sql).toBe(
            '(CASE WHEN (u."deletedAt" IS NOT NULL OR u."deletionRequestedAt" IS NOT NULL) THEN NULL ELSE u."displayName" END)'
        )
        expect(hiddenSql('author').sql).toBe(
            '(author."deletedAt" IS NOT NULL OR author."deletionRequestedAt" IS NOT NULL)'
        )
    })

    it('refuses an alias that is not letters only, as it goes into the SQL as written', () => {
        expect(() => hiddenSql('u; DROP TABLE "User"')).toThrow('Not a table alias')
    })
})
