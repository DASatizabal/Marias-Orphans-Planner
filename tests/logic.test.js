// Pure-logic tests for quarter.js, scoring.js and the calendar grid math.
// Run: node tests/logic.test.js   (no dependencies, no framework)

const Q = require('../js/quarter.js');
const S = require('../js/scoring.js');
const C = require('../js/calendar.js');
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
eq(b,{min:'2026-08-17',max:'2026-09-30',proposable:true,lookahead:false,maxLabel:'Q3 2026'},
   'bounds clamp to today');
eq(Q.validateDate('2026-08-01',i,'2026-08-17').ok,false,'past date rejected');
eq(Q.validateDate('2026-10-05',i,'2026-08-17').ok,false,'next-quarter date rejected');
eq(Q.validateDate('2026-09-30',i,'2026-08-17').ok,true,'last day of quarter accepted');
eq(Q.validateDate('2026-08-17',i,'2026-08-17').ok,true,'today accepted');

// --- next-quarter lookahead ---
// CONFIG is absent under node, so Quarter.lookaheadEnabled() defaults on here.
eq(Q.next('2026-Q3').quarterId,'2026-Q4','next within year');
eq(Q.next('2026-Q4').quarterId,'2027-Q1','next crosses year boundary');
eq(Q.next('garbage'),null,'next rejects garbage');
eq(Q.lastMonthStart(i),'2026-09-01','last month of Q3 starts Sep 1');
eq(Q.lastMonthStart(Q.fromId('2026-Q1')),'2026-03-01','last month of Q1 starts Mar 1');

// before the last month: window still stops at the quarter line
eq(Q.proposalBounds(i,'2026-08-31').max,'2026-09-30','Aug 31: no lookahead yet');
eq(Q.proposalBounds(i,'2026-08-31').lookahead,false,'Aug 31: lookahead closed');

// the day it opens, and after
const la = Q.proposalBounds(i,'2026-09-01');
eq(la,{min:'2026-09-01',max:'2026-12-31',proposable:true,lookahead:true,maxLabel:'Q4 2026'},
   'Sep 1 opens the whole of Q4');
eq(Q.proposalBounds(i,'2026-09-18').max,'2026-12-31','mid-September still sees Q4');

// what that means for validation
eq(Q.validateDate('2026-10-05',i,'2026-09-18').ok,true,'next-quarter date accepted in lookahead');
eq(Q.validateDate('2026-12-31',i,'2026-09-18').ok,true,'last day of next quarter accepted');
eq(Q.validateDate('2027-01-01',i,'2026-09-18').ok,false,'two quarters out still rejected');
eq(Q.validateDate('2027-01-01',i,'2026-09-18').error,'Q4 2026 ends Thu, Dec 31.',
   'error names the far quarter');
eq(Q.validateDate('2026-09-17',i,'2026-09-18').ok,false,'past date still rejected in lookahead');

// Q4 looks into next year
const q4 = Q.fromId('2026-Q4');
eq(Q.proposalBounds(q4,'2026-12-01').max,'2027-03-31','December opens Q1 of next year');

// --- rollover split ---
// What archiveIfStale() leans on: the board splits at the quarter's own
// closing date, and the frozen result is ranked over the kept half only.
const board = {
  sep:{date:'2026-09-25',time:'18:00',votes:{David:'yes',Maria:'yes'}},
  oct:{date:'2026-10-23',time:'18:00',votes:{David:'yes',Maria:'yes',Luz:'yes',Laura:'yes'}},
  nov:{date:'2026-11-06',time:'18:00',votes:{David:'yes'}}
};
const sp = Q.splitAtQuarterEnd(board,'2026-09-30');
eq(Object.keys(sp.kept),['sep'],'nights inside the quarter are kept');
eq(Object.keys(sp.carried).sort(),['nov','oct'],'nights past it are carried');
eq(sp.carried.oct.votes,{David:'yes',Maria:'yes',Luz:'yes',Laura:'yes'},'carried votes travel intact');

// the whole point: Oct 23 outscores Sep 25, but it is not Q3's outing
eq(S.rankProposals(board,R)[0].id,'oct','Oct 23 leads the combined board');
eq(S.rankProposals(sp.kept,R)[0].id,'sep',"Q3's frozen result ignores carried nights");

// a quarter that ended with nothing outstanding carries nothing
const tidy = { a:{date:'2026-09-25',votes:{David:'yes'}} };
eq(Q.splitAtQuarterEnd(tidy,'2026-09-30').carried,{},'nothing to carry when all nights fell inside');
eq(Object.keys(Q.splitAtQuarterEnd(tidy,'2026-09-30').kept),['a'],'tidy quarter keeps its own night');

// nothing fell inside: the quarter freezes empty and the whole board moves on
const allAhead = { a:{date:'2026-10-23',votes:{David:'yes'}} };
const sp2 = Q.splitAtQuarterEnd(allAhead,'2026-09-30');
eq(sp2.kept,{},'no in-quarter nights left behind');
eq(S.rankProposals(sp2.kept,R)[0],undefined,'empty kept half freezes a null result');

// a carried night that has already been and gone still moves, rather than
// vanishing between the two quarters when nobody opens the app for a month
eq(Object.keys(Q.splitAtQuarterEnd({p:{date:'2026-10-23',votes:{}}},'2026-09-30').carried),
   ['p'],'a past carried night still moves');
eq(Q.splitAtQuarterEnd({},'2026-09-30'),{kept:{},carried:{}},'empty board splits cleanly');
eq(Q.splitAtQuarterEnd(null,'2026-09-30'),{kept:{},carried:{}},'missing board splits cleanly');

// the boundary itself: the last night of the quarter stays
eq(Object.keys(Q.splitAtQuarterEnd({e:{date:'2026-09-30',votes:{}}},'2026-09-30').kept),
   ['e'],'the quarter\'s last day is inside it');

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

// --- calendar grid math ---
// August 2026 starts on a Saturday, so the 1st sits in the last column and
// every row below it is a full week. Good month for the rectangle cases.
const d = n => `2026-08-${String(n).padStart(2,'0')}`;

// THE case this feature exists for: press Wed Aug 5, drag down-right to Fri
// Aug 28, get every Wed/Thu/Fri in those four weeks -- 12 dates, not the 24
// days in between.
eq(C.rectBetween('2026-08-05','2026-08-28'),
   [5,6,7,12,13,14,19,20,21,26,27,28].map(d),'drag Wed 5 -> Fri 28 = every Wed/Thu/Fri');
eq(C.rectBetween('2026-08-28','2026-08-05'),C.rectBetween('2026-08-05','2026-08-28'),
   'drag is order-independent');
eq(C.rectBetween('2026-08-05','2026-08-05'),['2026-08-05'],'a tap is a 1x1 rectangle');
eq(C.rectBetween('2026-08-07','2026-08-28'),[7,14,21,28].map(d),'one column = every Friday');
eq(C.rectBetween('2026-08-09','2026-08-15'),[9,10,11,12,13,14,15].map(d),'one row = one week');
eq(C.rectBetween('2026-08-28','2026-09-02'),[],'a drag never crosses a month');

// grid geometry
eq(C.cellOf('2026-08-05'),{y:2026,m:8,d:5,index:10,row:1,col:3},'Aug 5 2026 is row 1, Wed');
eq(C.firstWeekday(2026,8),6,'Aug 1 2026 is a Saturday');
eq(C.firstWeekday(2026,2),0,'Feb 1 2026 is a Sunday -- no leading blanks');
eq(C.monthCells(2026,2).length,28,'a 28-day month starting Sunday trims to 4 rows');
eq(C.monthCells(2026,8).filter(Boolean).length,31,'August has 31 real cells');
eq(C.monthCells(2026,8)[0],null,'August leads with a blank');

// The reason every step above is arithmetic on the day NUMBER: March 8 2026 is
// the US DST jump. Stepping days by adding 86400000 skips or repeats one here.
const mar = C.rectBetween('2026-03-08','2026-03-14');
eq(mar.length,7,'DST week has 7 cells');
eq(new Set(mar).size,7,'DST week has no repeated date');
eq(mar[0],'2026-03-08','DST week starts on the 8th');
eq(mar[6],'2026-03-14','DST week ends on the 14th');

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail?1:0);
