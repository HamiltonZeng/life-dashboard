import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduledPeriod} from '../../packages/domain/src/phase2/schedule.js';
import {explicitCreation,effectiveIntent} from '../../packages/ai/src/v03/compiler.js';
const def={category:'daily',timezone:'Asia/Shanghai',due_at:null,schedule:{active_from:'2026-10-21',active_until:'2026-11-01',weekdays:[1,3,5],preferred_local_time:null}};
test('P1-A09 future, weekdays, expiry and natural weekly/monthly clipping',()=>{
 assert.equal(scheduledPeriod(def,new Date('2026-10-20T12:00:00+08:00')).period,null);
 assert.equal(scheduledPeriod(def,new Date('2026-10-21T12:00:00+08:00')).period?.end,'2026-10-21T16:00:00.000Z');
 const off=scheduledPeriod(def,new Date('2026-10-22T12:00:00+08:00'));assert.equal(off.period,null);assert.equal(off.next_check_at,'2026-10-22T16:00:00.000Z');
 assert.deepEqual(scheduledPeriod(def,new Date('2026-11-02T00:00:00+08:00')),{period:null,next_check_at:null});
 for(const category of ['main','weekly','monthly']){const p=scheduledPeriod({...def,category,schedule:{...def.schedule,weekdays:null}},new Date('2026-10-21T12:00:00+08:00'));assert.ok(p.period);assert.ok(Date.parse(p.period!.start)>=Date.parse('2026-10-21T00:00:00+08:00'));}
 const dst=scheduledPeriod({category:'daily',timezone:'America/New_York',due_at:null,schedule:{active_from:'2026-10-01',active_until:'2026-11-30',weekdays:null,preferred_local_time:null}},new Date('2026-11-01T12:00:00-05:00')).period!;assert.equal(Date.parse(dst.end!)-Date.parse(dst.start),25*3600000);
});
test('P1-A05 only explicit creation authorizes automatic application',()=>{
 assert.equal(explicitCreation('帮我安排未来30天每天学习20分钟'),true);
 for(const text of ['不要帮我安排任务','如果帮我安排任务会怎样','“帮我创建任务”是例子','如何创建目标？','我这周学习怎么样','我打算明天跑步'])assert.equal(explicitCreation(text),false,text);
});

test('F01 clarification restrictions are monotonic and cannot enlarge the original execution grant',()=>{
 const base={original_text:'帮我安排英语学习',execution:'auto'};
 assert.equal(effectiveIntent({...base,answers:['先预览','现在直接创建']}).mode,'preview');
 assert.equal(effectiveIntent({...base,execution:'preview',answers:['现在直接创建']}).mode,'preview');
 assert.equal(effectiveIntent({...base,answers:['取消本次请求','现在直接创建']}).mode,'cancelled');
 assert.equal(effectiveIntent({...base,answers:['30天，每天20分钟']}).mode,'auto');
 for(const text of ['请帮我取消本次请求','不用创建了','cancel this request'])assert.equal(effectiveIntent({...base,answers:[text]}).mode,'cancelled');
 assert.equal(effectiveIntent({...base,answers:['30天，please preview only']}).mode,'preview');
});
