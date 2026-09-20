import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const DEMO_USERNAME=/^[a-zA-Z0-9_-]{1,64}$/;
export const DEMO_PASSWORD_MIN=8;
export const demoAccountsPath=dbPath=>dbPath===':memory:'?':memory:':dbPath+'.accounts';

const hash=(password,salt)=>scryptSync(password,salt,64);

export function createDemoAccounts(path=':memory:'){
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt BLOB NOT NULL, digest BLOB NOT NULL, created INTEGER NOT NULL);`);
  const exists=name=>!!db.prepare('SELECT 1 FROM users WHERE name=?').get(typeof name==='string'?name:'');
  return {
    exists,
    create(name,password){
      if(!DEMO_USERNAME.test(name??''))throw Error('INVALID_USER');
      if(typeof password!=='string'||password.length<DEMO_PASSWORD_MIN)throw Error('WEAK_PASSWORD');
      if(exists(name))throw Error('USERNAME_TAKEN');
      const salt=randomBytes(16);
      db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(name,salt,hash(password,salt),Date.now());
      return {userId:name};
    },
    verify(name,password){
      const record=db.prepare('SELECT * FROM users WHERE name=?').get(typeof name==='string'?name:'');
      if(!record||typeof password!=='string')return false;
      const supplied=hash(password,record.salt),digest=Buffer.from(record.digest);
      return supplied.length===digest.length&&timingSafeEqual(supplied,digest);
    },
    remove(name){return db.prepare('DELETE FROM users WHERE name=?').run(typeof name==='string'?name:'').changes>0;},
    clear(){return db.prepare('DELETE FROM users').run().changes;},
    list(){return db.prepare('SELECT name,created FROM users ORDER BY created,name').all();},
    count(){return db.prepare('SELECT count(*) AS n FROM users').get().n;},
    close(){db.close();},
  };
}
