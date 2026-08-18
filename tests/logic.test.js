// Pure-logic tests for quarter.js and scoring.js.
// Run: node tests/logic.test.js   (no dependencies, no framework)

const Q = require('../js/quarter.js');
const S = require('../js/scoring.js');
const R = ['David','Maria','Luz','Laura','Bernice','Crisveth'];
let fail = 0;
const eq = (a,b,m) => { const A=JSON.stringify(a),B=JSON.stringify(b);
  if(A!==B){console.log('FAIL',m,'\n  got     ',A,'\n  expected',B); fail++;} else console.log('ok  ',m); };

// --- quarter math ---
const i = Q.info(new Date(2026,7,17));           // Aug 17 2026
eq(i.quarterId,'2026-Q3','quarterId');
eq(i.label,'Q3 2026','label');
eq(i.startDate,'2026-07-01','quarter start');
eq(i.endDate,'2026-09-30','quarter end');
eq(Q.info(new Date(2026,11,31)).endDate,'2026-12-31','Q4 ends Dec 31');
eq(Q.info(new Date(2026,0,1)).startDate,'2026-01-01','Q1 starts Jan 1');
eq(Q.previous('2026-Q1').quarterId,'2025-Q4','previous crosses year boundary');
eq(Q.previous('2026-Q4').quarterId,'2026-Q3','previous within year');
eq(Q.fromId('2026-Q3').endDate,'2026-09-30','fromId round trip');
eq(Q.fromId('garbage'),null,'fromId rejects garbage');

// the timezone trap: local date must survive a round trip unshifted
eq(Q.fmtDate(Q.parseDate('2026-09-30')),'2026-09-30','date round trip (no UTC shift)');
eq(Q.prettyDate('2026-09-30').slice(0,3),'Wed','Sep 30 2026 is a Wednesday');

// --- proposal bounds ---
const b = Q.proposalBounds(i,'2026-08-17');
eq(b,{min:'2026-08-17',max:'2026-09-30',proposable:true},'bounds clamp to today');
eq(Q.validateDate('2026-08-01',i,'2026-08-17').ok,false,'past date rejected');
eq(Q.validateDate('2026-10-05',i,'2026-08-17').ok,false,'next-quarter date rejected');
eq(Q.validateDate('2026-09-30',i,'2026-08-17').ok,true,'last day of quarter accepted');
eq(Q.validateDate('2026-08-17',i,'2026-08-17').ok,true,'today accepted');

// --- scoring ---
const props = {
  a:{date:'2026-09-12',time:'18:30',createdAt:'2026-08-17T14:00:00Z',
     votes:{Maria:'yes',David:'yes',Laura:'maybe',Bernice:'no'}},
  b:{date:'2026-09-19',time:'19:00',createdAt:'2026-08-17T14:09:00Z',
     votes:{Luz:'yes',David:'maybe'}}
};
let r = S.rankProposals(props,R);
eq(r[0].id,'a','higher score wins');
eq(r[0].score,5,'2+2+1+0 = 5');
eq(r[0].missing.sort(),['Crisveth','Luz'],'per-proposal missing');
eq(S.waitingOn(props,R),['Crisveth'],'global waiting-on');

// tie-break 4: identical votes -> earlier date wins
const tie = {
  late :{date:'2026-09-19',createdAt:'2026-08-01T00:00:00Z',votes:{David:'yes',Maria:'yes'}},
  early:{date:'2026-09-12',createdAt:'2026-08-02T00:00:00Z',votes:{David:'yes',Maria:'yes'}}
};
eq(S.rankProposals(tie,R)[0].id,'early','tie-break: earlier date beats earlier createdAt');

// tie-break 2: same score, more yes wins
const t2 = { m:{date:'2026-09-12',votes:{David:'maybe',Maria:'maybe',Luz:'maybe',Laura:'maybe'}},
             y:{date:'2026-09-12',votes:{David:'yes',Maria:'yes'}} };
eq(S.rankProposals(t2,R)[0].id,'y','tie-break: more yes votes wins at equal score');

// off-roster votes are ignored
eq(S.rankProposals({x:{date:'2026-09-12',votes:{Gandalf:'yes',David:'yes'}}},R)[0].score,2,'off-roster vote ignored');
eq(S.rankProposals({x:{date:'2026-09-12',votes:{David:'banana'}}},R)[0].score,0,'bogus vote value ignored');

// confidence states
eq(S.confidence(S.rankProposals({},R),R).state,'none','no proposals -> none');
eq(S.confidence(S.rankProposals({x:{date:'2026-09-12',votes:{David:'yes'}}},R),R).state,'thin','1 voter -> thin');
eq(S.confidence(r,R).state,'leading','4 voters -> leading');
const all = {x:{date:'2026-09-12',votes:Object.fromEntries(R.map(n=>[n,'yes']))}};
eq(S.confidence(S.rankProposals(all,R),R).state,'all-in','6 voters -> all-in');
eq(S.confidence(S.rankProposals(all,R),R).blockers,[],'no blockers when all yes');
eq(S.confidence(r,R).blockers,['Bernice'],'blocker surfaced');

// decisive: leader 5, rival 3 with 4 missing -> maxReachable 11, not decisive
eq(S.confidence(r,R).decisive,false,'not decisive while rival can still catch up');
const dec = {
  win :{date:'2026-09-12',votes:Object.fromEntries(R.map(n=>[n,'yes']))},   // 12
  lose:{date:'2026-09-19',votes:Object.fromEntries(R.map(n=>[n,'maybe']))}  // 6, 0 missing
};
eq(S.confidence(S.rankProposals(dec,R),R).decisive,true,'decisive when rivals are maxed out');

// venues
const v = { p:{name:'A',createdAt:'1',upvotes:{David:true,Luz:true}},
            q:{name:'B',createdAt:'0',upvotes:{David:true,Ghost:true}} };
const rv = S.rankVenues(v,R);
eq([rv[0].id,rv[0].count,rv[1].count],['p',2,1],'venue ranking ignores off-roster upvotes');

// a lone proposal is never "decisive": someone can still add a new date
eq(S.confidence(S.rankProposals({x:{date:'2026-09-12',votes:Object.fromEntries(R.map(n=>[n,'yes']))}},R),R).decisive,
   false,'single proposal is not decisive');

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail?1:0);
