import { describeDevice } from './device'

// Real user agents, as browsers sent them in 2025–2026.
const UA = {
    chromeWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edgeWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    operaWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
    coccocWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/141.0.200 Chrome/135.0.0.0 Safari/537.36',
    firefoxUbuntu: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    safariMac:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    chromeMac:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    safariIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    chromeIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
    firefoxIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
    edgeIphone:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.71 Mobile/15E148 Safari/605.1.15',
    safariIpad:
        'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    chromeAndroidPhone:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    chromeAndroidTablet:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    samsungAndroid:
        'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    edgeAndroid:
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0',
    chromeOs:
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    chromiumLinux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/141.0.0.0 Chrome/141.0.0.0 Safari/537.36'
}

describe('describeDevice', () => {
    it.each([
        ['chromeWindows', 'Chrome', 'Windows', 'desktop'],
        // Edge, Opera and Cốc Cốc also say Chrome and Safari: their own token wins.
        ['edgeWindows', 'Edge', 'Windows', 'desktop'],
        ['operaWindows', 'Opera', 'Windows', 'desktop'],
        ['coccocWindows', 'Cốc Cốc', 'Windows', 'desktop'],
        ['firefoxUbuntu', 'Firefox', 'Ubuntu', 'desktop'],
        ['firefoxLinux', 'Firefox', 'Linux', 'desktop'],
        ['safariMac', 'Safari', 'macOS', 'desktop'],
        // Chrome says Safari too; Safari is only Safari when nothing else claims it.
        ['chromeMac', 'Chrome', 'macOS', 'desktop'],
        // An iPhone says "like Mac OS X".
        ['safariIphone', 'Safari', 'iOS', 'mobile'],
        ['chromeIphone', 'Chrome', 'iOS', 'mobile'],
        ['firefoxIphone', 'Firefox', 'iOS', 'mobile'],
        ['edgeIphone', 'Edge', 'iOS', 'mobile'],
        ['safariIpad', 'Safari', 'iPadOS', 'tablet'],
        // Android says Linux.
        ['chromeAndroidPhone', 'Chrome', 'Android', 'mobile'],
        ['chromeAndroidTablet', 'Chrome', 'Android', 'tablet'],
        ['samsungAndroid', 'Samsung Internet', 'Android', 'mobile'],
        ['edgeAndroid', 'Edge', 'Android', 'mobile'],
        ['chromeOs', 'Chrome', 'ChromeOS', 'desktop'],
        ['chromiumLinux', 'Chromium', 'Linux', 'desktop']
    ] as const)('reads %s as %s on %s (%s)', (key, browser, os, kind) => {
        expect(describeDevice(UA[key])).toEqual({ browser, os, kind })
    })

    it('says nothing it cannot read: no header, a tool, or junk', () => {
        const unknown = { browser: null, os: null, kind: 'desktop' }
        expect(describeDevice(undefined)).toEqual(unknown)
        expect(describeDevice(null)).toEqual(unknown)
        expect(describeDevice('')).toEqual(unknown)
        expect(describeDevice('curl/8.7.1')).toEqual(unknown)
        expect(describeDevice('jest')).toEqual(unknown)
    })

    it('names the system when the browser is unknown, and the other way round', () => {
        expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomeBot/1.0')).toEqual({
            browser: null,
            os: 'Windows',
            kind: 'desktop'
        })
        expect(describeDevice('Mozilla/5.0 (PlayStation; PlayStation 5/2.26) Firefox/120.0')).toEqual({
            browser: 'Firefox',
            os: null,
            kind: 'desktop'
        })
    })
})
