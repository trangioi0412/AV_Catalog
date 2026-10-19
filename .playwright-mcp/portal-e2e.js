async (page) => {
  // End-to-end check of AVS_Portal (dev server :3100, SMTP disabled, data/e2e-test.xlsx).
  const BASE = 'http://localhost:3100';
  const fs = require('fs');
  const LOG = 'C:/Users/Dell/AppData/Local/Temp/claude/d--Website-Cty-AV-Catalog/006e792a-53cf-4600-b13e-e32acbb847f4/scratchpad/portal-dev.log';
  const out = [];
  const step = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  const browser = page.context().browser();
  const PASSWORD = 'TestPortal2026';

  const linkFor = async (email, kind) => {
    for (let i = 0; i < 40; i++) {
      const text = fs.readFileSync(LOG, 'utf8');
      const block = text.split('[mail] SMTP not configured').filter((b) => b.includes(email)).pop();
      const m = block && block.match(new RegExp(`http://localhost:3100/${kind}\\?token=[A-Za-z0-9_-]+`));
      if (m) return m[0];
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };

  async function registerAndVerify(ctx, name, email) {
    const p = await ctx.newPage();
    await p.goto(BASE + '/register');
    await p.fill('#name', name);
    await p.fill('#email', email);
    await p.fill('#password', PASSWORD);
    await p.fill('#confirm', PASSWORD);
    await p.click('button[type=submit]');
    await p.getByText('Đã gửi email xác minh').waitFor({ timeout: 30000 });
    const link = await linkFor(email, 'verify-email');
    await p.goto(link);
    const verified = await p.getByText('Tài khoản đã được kích hoạt').isVisible();
    await p.close();
    return verified;
  }

  async function login(ctx, email) {
    const p = await ctx.newPage();
    await p.goto(BASE + '/login');
    await p.fill('#email', email);
    await p.fill('#password', PASSWORD);
    await p.click('button[type=submit]');
    await p.waitForURL('**/portal', { timeout: 30000 });
    return p;
  }

  // 1. Home lists websites (public)
  const anon = await browser.newContext();
  const home = await anon.newPage();
  await home.goto(BASE + '/');
  const cards = await home.locator('a[href^="/sso/"]').count();
  step('home lists websites', cards === 2, `${cards} cards`);

  // 2. Register rejects non-company email
  const r = await anon.newPage();
  await r.goto(BASE + '/register');
  await r.fill('#name', 'Ngoai Le');
  await r.fill('#email', 'someone@gmail.com');
  await r.fill('#password', PASSWORD);
  await r.fill('#confirm', PASSWORD);
  await r.click('button[type=submit]');
  step('register rejects non-company email', await r.getByText('Chỉ chấp nhận email công ty').waitFor({ timeout: 10000 }).then(() => true, () => false));

  // 3. Protected pages redirect; staff account flow
  const staffCtx = await browser.newContext();
  const probe = await staffCtx.newPage();
  await probe.goto(BASE + '/portal');
  step('portal redirects to login when signed out', probe.url().includes('/login?next=%2Fportal'), probe.url());

  step('staff register + verify', await registerAndVerify(staffCtx, 'Nhan Vien Test', 'e2e.staff@avs-tek.vn'));
  const staffPortal = await login(staffCtx, 'e2e.staff@avs-tek.vn');
  step('staff sees empty portal', await staffPortal.getByText('Chưa có website nào được cấp').isVisible());
  const noAccess = await staffCtx.request.get(BASE + '/sso/av-catalog', { maxRedirects: 0 });
  step('staff SSO to ungranted site refused', noAccess.status() === 307 && (noAccess.headers().location || '').includes('error=no-access'), String(noAccess.status()));
  await staffPortal.goto(BASE + '/admin');
  step('staff cannot open /admin', staffPortal.url().endsWith('/portal'), staffPortal.url());

  // 4. Super admin
  const bossCtx = await browser.newContext();
  step('super admin register + verify', await registerAndVerify(bossCtx, 'Jace Tran', 'jace.tran@avs-tek.vn'));
  const bossPortal = await login(bossCtx, 'jace.tran@avs-tek.vn');
  const bossCards = await bossPortal.locator('a[href^="/sso/"]').count();
  step('super admin sees all websites', bossCards === 2, `${bossCards}`);

  // 5. Admin grants staff "viewer" on av-catalog
  await bossPortal.goto(BASE + '/admin?q=e2e.staff');
  await bossPortal.getByLabel('Quyền của e2e.staff@avs-tek.vn trên AV Catalog Manager').selectOption('viewer');
  await bossPortal.getByText('Đã cập nhật quyền website.').waitFor({ timeout: 30000 });
  step('admin grants website access', true);
  await bossPortal.goto(BASE + '/admin');
  await bossPortal.screenshot({ path: '.playwright-mcp/portal-admin.png' });

  // 6. Staff now sees and can launch the site; token is valid ES256 for that audience
  await staffPortal.goto(BASE + '/portal');
  step('staff sees granted website', (await staffPortal.locator('a[href="/sso/av-catalog"]').count()) === 1);
  await staffPortal.screenshot({ path: '.playwright-mcp/portal-staff.png' });
  const sso = await staffCtx.request.get(BASE + '/sso/av-catalog?next=/admin/dashboard', { maxRedirects: 0 });
  const html = await sso.text();
  const action = (html.match(/action="([^"]+)"/) || [])[1];
  const token = (html.match(/name="token" value="([^"]+)"/) || [])[1];
  step('SSO page posts to website callback', sso.status() === 200 && action === 'http://localhost:3000/auth/sso', action);
  const payload = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) : {};
  const header = token ? JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) : {};
  step('SSO token claims', header.alg === 'ES256' && payload.aud === 'av-catalog' && payload.siteRole === 'viewer' && payload.email === 'e2e.staff@avs-tek.vn' && payload.exp - payload.iat === 60, JSON.stringify({ alg: header.alg, aud: payload.aud, siteRole: payload.siteRole }));
  step('SSO response not cacheable', (sso.headers()['cache-control'] || '').includes('no-store'));

  // 7. Disable staff -> session revoked immediately
  await bossPortal.goto(BASE + '/admin?q=e2e.staff');
  bossPortal.once('dialog', (d) => d.accept());
  await bossPortal.getByRole('button', { name: 'Vô hiệu hoá' }).click();
  await bossPortal.getByText('Đã vô hiệu hoá tài khoản.').waitFor({ timeout: 30000 });
  await staffPortal.goto(BASE + '/portal');
  step('disabled user is signed out', staffPortal.url().includes('/login'), staffPortal.url());

  // 8. JWKS
  const jwks = await anon.request.get(BASE + '/.well-known/jwks.json').then((res) => res.json());
  step('JWKS exposes one public EC key', jwks.keys?.length === 1 && jwks.keys[0].kty === 'EC' && !jwks.keys[0].d);

  await home.setViewportSize({ width: 375, height: 812 });
  await home.goto(BASE + '/');
  await home.screenshot({ path: '.playwright-mcp/portal-home-mobile.png', fullPage: true });
  const lp = await anon.newPage();
  await lp.setViewportSize({ width: 1440, height: 900 });
  await lp.goto(BASE + '/login');
  await lp.screenshot({ path: '.playwright-mcp/portal-login.png' });

  await anon.close(); await staffCtx.close(); await bossCtx.close();
  return out;
}
