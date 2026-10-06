import assert from 'node:assert/strict';
import {groupCenter,groupsForCategory,resolveCategoryId,splitLinesByPrinterGroup,pickOrderPrinter,planPrinterJobs} from '../src/services/printRoutingCore.js';

const groups=[{id:'bar',name:'BAR POS',productionCenter:'Bar',categoryIds:['beer','wine']},{id:'kit',name:'KITCHEN POS',categoryIds:['burger']},{id:'all',name:'EVERYTHING',categoryIds:['burger']}];
const categories=[{id:'beer',name:'Beer'},{id:'burger',name:'Burgers'}];
assert.equal(groupCenter(groups[0]),'Bar');
assert.equal(groupCenter(groups[1]),'KITCHEN POS');
assert.deepEqual(groupsForCategory('burger',groups).map(g=>g.id),['kit','all']);
assert.equal(resolveCategoryId({category:'  bUrGeRs '},categories),'burger');
assert.equal(resolveCategoryId({categoryId:'explicit',category:'Beer'},categories),'explicit');
const split=splitLinesByPrinterGroup([{name:'B',category:'Burgers'},{name:'X',category:'Dessert'}],{groups,categories});
assert.equal(split.buckets.length,2);
assert.equal(split.unrouted.length,1);
const printers=[{id:'bar-printer',purposes:['order'],center:'Bar'},{id:'kitchen-printer',purposes:['order'],center:'Kitchen'}];
assert.equal(pickOrderPrinter('Bar',printers)?.id,'bar-printer');
const plan=planPrinterJobs([{name:'B',category:'Burgers'}],{groups,categories,printers});
assert.equal(plan.jobs.length,2);
assert.equal(plan.jobs.find(j=>j.groupId==='kit').printer?.id,'kitchen-printer');
console.log('printer routing core: ok');
