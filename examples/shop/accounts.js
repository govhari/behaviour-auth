import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const USERNAME=/^[a-zA-Z0-9_-]{3,64}$/;

export const SESSION_MS = 86400000;

const hash=(password,salt)=>scryptSync(password,salt,64);

export function createAccounts(path=':memory:'){
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt BLOB NOT NULL, digest BLOB NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL);`);
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());

  const session=id=>{
    if(typeof id!=='string'||!id)return null;
    const row=db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    if(!row)return null;
    if(Date.now()>=row.expires){db.prepare('DELETE FROM sessions WHERE id=?').run(id);return null;}
    return {row,state:JSON.parse(row.body)};
  };

  const exists=name=>!!db.prepare('SELECT 1 FROM users WHERE name=?').get(name??'');

  return {
    exists,
    count:()=>db.prepare('SELECT count(*) AS n FROM users').get().n,
    create(name,password){
      if(!USERNAME.test(name??''))throw Error('INVALID_USERNAME');
      if(typeof password!=='string'||password.length<8)throw Error('WEAK_PASSWORD');
      if(exists(name))throw Error('USERNAME_TAKEN');
      const salt=randomBytes(16);
      db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(name,salt,hash(password,salt),Date.now());
      return {userId:name};
    },
    verify(name,password){
      const record=db.prepare('SELECT * FROM users WHERE name=?').get(name??'');
      if(!record||typeof password!=='string')return false;
      const supplied=hash(password,record.salt),digest=Buffer.from(record.digest);
      return supplied.length===digest.length&&timingSafeEqual(supplied,digest);
    },
    open(state={}){
      const id=randomBytes(24).toString('hex'),now=Date.now();
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id,now,now+SESSION_MS,JSON.stringify(state));
      return id;
    },
    read:id=>session(id)?.state??null,
    update(id,patch){
      const found=session(id);if(!found)return null;
      const next={...found.state,...patch};
      db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify(next),id);
      return next;
    },
    close(id){db.prepare('DELETE FROM sessions WHERE id=?').run(id??'');},
    remove(name){
      const user=typeof name==='string'?name:'';
      db.prepare("DELETE FROM sessions WHERE json_extract(body,'$.user')=? OR json_extract(body,'$.enrolling')=?").run(user,user);
      return db.prepare('DELETE FROM users WHERE name=?').run(user).changes>0;
    },
    clear(){db.prepare('DELETE FROM sessions').run();return db.prepare('DELETE FROM users').run().changes;},
    shutdown(){db.close();},
  };
}
