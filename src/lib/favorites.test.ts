import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addFavorite, decodeFavorites, FAVORITES_LIMIT, type Favorite } from './favorites.ts';
import { watchKey } from './watch-history.ts';
const record: Favorite = {
  id: watchKey({builtinId:'curated'}, 'site', '7'), selection:{builtinId:'curated'},
  libraryName:'精选',revision:'r1',siteKey:'site',siteName:'来源甲',
  film:{id:'7',name:'同名影片',poster:null,year:'2026',category:'电影',remarks:''},addedAt:1,
};
test('收藏持久化保留来源快照，同名跨站与跨订阅各自独立，重复添加不移动顺序', () => {
  let records = addFavorite([], record);
  const other = {...record, siteKey:'other',siteName:'来源乙',id:watchKey(record.selection,'other','7')};
  records = addFavorite(records, other);
  assert.equal(addFavorite(records, record), records);
  const third = {...record,selection:{builtinId:'extended'},id:watchKey({builtinId:'extended'},'site','7')};
  records = addFavorite(records, third);
  assert.equal(records.length,3);
  assert.deepEqual(decodeFavorites(JSON.stringify({version:1,records})), records);
  const removed = records.filter(item => item.id !== other.id);
  assert.deepEqual(decodeFavorites(JSON.stringify({version:1,records:removed})).map(item=>item.siteName),['来源甲','来源甲']);
  assert.deepEqual(decodeFavorites(null),[]);
  assert.deepEqual(decodeFavorites(JSON.stringify({version:1,records:[]})),[]);
});
test('来源失效不删除收藏快照；未知版本、重复身份、损坏数据和非法来源不可冒充空收藏', () => {
  const restored=decodeFavorites(JSON.stringify({version:1,records:[record]}));
  assert.equal(restored[0].siteName,'来源甲');
  assert.equal(restored[0].film.name,'同名影片');
  for(const raw of ['', '{', 'null', JSON.stringify({version:2,records:[]}),
    JSON.stringify({version:1,records:[record,record]}),
    JSON.stringify({version:1,records:[{...record,id:'other'}]}),
    JSON.stringify({version:1,records:[{...record,selection:{url:'file:///x'}}]}),
    JSON.stringify({version:1,records:[{...record,addedAt:-1}]}),
    JSON.stringify({version:1,records:[{...record,film:{...record.film,poster:'javascript:alert(1)'}}]})])
    assert.throws(()=>decodeFavorites(raw));
});
test('达到收藏上限时保留已有条目，不静默淘汰；重复收藏仍为幂等', () => {
  const records=Array.from({length:FAVORITES_LIMIT},(_,i)=>({...record,id:watchKey(record.selection,'site',String(i)),film:{...record.film,id:String(i)}}));
  assert.equal(addFavorite(records,records[0]),records);
  assert.throws(()=>addFavorite(records,{...record,id:watchKey(record.selection,'site','extra'),film:{...record.film,id:'extra'}}),/最多收藏/);
  assert.equal(records.length,FAVORITES_LIMIT);
});
