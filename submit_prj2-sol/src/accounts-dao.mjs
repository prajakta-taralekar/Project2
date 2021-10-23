import { AppErrors } from 'cs544-js-utils';
import { genId } from './util.mjs';
import { DEFAULT_COUNT } from './defs.mjs';

import mongo from 'mongodb';

/** Return DAO for DB URL url and options. Only option is
 *  options.doClear; if specified, then all data should be cleared.
 * 
 *  Returned DAO should support a close() method.  
 *
 *  Returned DAO should also support a newAccount(), info(), newAct(),
 *  query() and statement() methods with each method taking a single
 *  params object as argument.  The params argument and return values
 *  for these methods are as documented for project 1.
 *
 *  It is assumed that params is fully validated except that id may
 *  not refer to an existing account.  Can also assume that values
 *  in params have been converted as necessary:
 * 
 *    params.amount:  Number in cents.
 *    params.index:   Number with default filled in.
 *    params.count:   Number with default filled in.
 *
 *  (see table in accounts-services.mjs for validations and conversions).
 *
 *  [Note that unlike project 1, there is no intermediate account()
 *  method or corresponding object, all methods operate directly on
 *  the returned DAO.]
 *
 */
export default async function makeAccountsDao(url, options) {
  //TODO
  return AccountsDao.make(url);
}

//use in mongo.connect() to avoid warning
const MONGO_CONNECT_OPTIONS = { useUnifiedTopology: true };

//TODO

class AccountsDao {
  constructor(props) {
    Object.assign(this, props);
  }

  //factory since async constructor cannot work
  static async make(mongoUrl) {
    try {
      const client = await mongo.MongoClient.connect(mongoUrl, MONGO_CONNECT_OPTIONS);
      const db = client.db();
      const accounts = db.collection(ACCOUNTS_TABLE);
      const transactions = db.collection(TRANSACTIONS_TABLE);
      return new AccountsDao({ client, accounts: accounts, transactions: transactions });
    }
    catch (err) {
      return { errors: { code: 'DB', msg: err.toString() } };
    }
  }

  /** Release all resources held by this image store.  Specifically,
   *  close any database connections.
   */
  async clear() {
    try {
      await this.accounts.deleteMany({});
    }
    catch (err) {
      return errors('DB', err.toString());
    }
  }

  async close() {
    try {
      await this.client.close();
    }
    catch (err) {
      return { errors: { code: 'DB', msg: err.toString() } };
    }
  }

  async newAccount(account) {
    try {
      const dbAccount = await toDbAccount(Object.assign({}, account, { id: genId(), balance: 0 }));
      if (dbAccount.errors) return dbAccount;
      const ret = await this.accounts.insertOne(dbAccount);
      return dbAccount._id;
    }
    catch (err) {
      if (isDuplicateError(err)) {
        return errors('EXISTS', `account ${account.id} already exists`);
      }
      else {
        return { errors: { code: 'DB', msg: err.toString() } };
      }
    }
  }

  async info(account) {
    try {
      const dbAccount = await toDbAccount(account);

      if (dbAccount.errors) return dbAccount;
      const ret = await this.accounts.find(dbAccount);
      const retAccounts = await ret.toArray();

      if (retAccounts.length === 0) {
        const errors = new AppErrors();
        errors.add(`account ${account.id} not found`, { code: 'NOT_FOUND' });
        return errors;
      }
      else if (retAccounts.length !== 1) {
        return `multiple accounts ${retAccounts.length} for ` + `account ${account.id}`;
      }
      else {
        return fromDbAccount(retAccounts[0]);
      }
    }
    catch (err) {
      return errors('DB', err.toString());
    }
  }

  async newAct(act) {
    try {
      let errors = new AppErrors();
      if (!act.id) {
        errors.add(`id required`, { code: 'BAD_REQ' });
        return errors;
      }
      if (!act.date) {
        errors.add(`date required`, { code: 'BAD_REQ' });
        return errors;
      }
      if (!act.amount) {
        errors.add(`amount required`, { code: 'BAD_REQ' });
        return errors;
      }
      if (!act.memo) {
        errors.add(`memo required`, { code: 'BAD_REQ' });
        return errors;
      }
      const dbAccount = await this.accounts.findOne({ _id: act.id });
      const updatedBalance = Number(dbAccount.balance) + Number(act.amount);
      const dbAct = await Object.assign({}, act, { actId: genId(), balance: Number(updatedBalance.toFixed(2)) });
      await this.accounts.updateOne({ _id: act.id }, { $set: { balance: Number(updatedBalance.toFixed(2)) } }, { upsert: true });
      if (dbAct.errors) return dbAct;
      const ret = await this.transactions.insertOne(dbAct);
      return dbAct.actId;
    }
    catch (error) {
      throw error;
    }
  }

  async query(filter) {
    let index = 0;
    let count = DEFAULT_COUNT;
    if (filter.index)
      index = filter.index;
    if (filter.count)
      count = filter.count;
    let act = {};
    if (filter.id) {
      act.id = filter.id;
    }
    if (filter.actId) {
      act.actId = filter.actId;
    }
    if (filter.date) {
      try {
        let dt = new Date(filter.date);
      }
      catch (error) {
        const errors = new AppErrors();
        errors.add(`bad date`, { code: 'BAD_VAL' });
        return errors;
      }
      act.date = filter.date;
    }
    if (filter.memoText) {
      act.memo = new RegExp(filter.memoText, "i");
    }

    const acts = await this.transactions.find(act).sort({ "date": 1 }).skip(index).limit(count);

    return acts.toArray();
  }

  async statement(filter) {
    let stmt = {};
    if (filter.id)
      stmt.id = filter.id;
    if (filter.fromDate)
      stmt.date = { $gte: filter.fromDate, $lte: filter.toDate };
    const stmts = await this.transactions.find(stmt).sort({ "date": 1 });
    return await stmts.toArray();
  }

}

const ACCOUNTS_TABLE = "accountInfos";
const TRANSACTIONS_TABLE = "transactionInfos";

function fromDbAccount(dbAccount) {
  const account = Object.assign({}, dbAccount, { id: dbAccount._id });
  delete account._id;
  return account;
}

function toDbAccount(account) {
  if (account._id) {
    const msg = `invalid property name _id for account ${JSON.stringify(account)}`;
    return errors('BAD_KEY', msg);
  }
  if (account.id === null || account.id === undefined) {
    const msg = `cannot get id for account ${JSON.stringify(account)}`;
    return errors('NO_ID', msg);
  }
  const dbAccount = Object.assign({}, account, { _id: account.id });
  delete dbAccount.id;
  return dbAccount;
}

function errors(code, msg) {
  return { errors: [new AppErrors().add(msg, code)] };
}

function isDuplicateError(err) {
  return (err.code === 11000);
}