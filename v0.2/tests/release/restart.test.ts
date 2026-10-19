import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
test('A16: application restart preserves committed records',async()=>{
  assert.equal(process.env.RELEASE_TEST,'1');assert.equal(process.env.DATABASE_NAME,'life_dashboard_release_test');
  const dir='.runtime/test-artifacts/stage3-final',probe=JSON.parse(readFileSync(dir+'/restart-probe.json','utf8'));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{const page=await browser.newPage();await page.goto('http://gateway/');await page.locator('[name=login_secret]').fill(process.env.LOCAL_LOGIN_SECRET!);await page.locator('#ld-login-form button[type=submit]').click();await page.locator('#ld-home-blank').waitFor();await page.goto('http://gateway/records');await page.locator(`[data-action=open-edit-record][data-record-id="${probe.id}"]`).waitFor();const matrix=JSON.parse(readFileSync(dir+'/acceptance.json','utf8'));matrix.A16={status:'PASS'};assert.equal(Object.keys(matrix).length,16);assert.ok(Object.values(matrix).every((r:any)=>r.status==='PASS'));writeFileSync(dir+'/acceptance.json',JSON.stringify(matrix,null,2));}finally{await browser.close();}
});
