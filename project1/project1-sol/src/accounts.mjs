import { AppErrors } from 'cs544-js-utils';

import { getDate, getPositiveInt, getCents, genId } from './util.mjs';

/**
API to maintain bank accounts.  The API data model includes the
following entities:

  Account Holder: External to this API.  Simply represented by an
  externally generated opaque holderId ID.

  Account: Identified by an ID (generated within this API).  Will
  track its holder using the holderId ID.  It will also contain a
  collection of transactions.

  Transaction: Contains

     { id, amount, date, memo } 

  where id is the transaction ID (generated within this API), amount
  is a Number giving the amount of the transaction (>= 0 for deposits,
  < 0 for withdrawals), date is a YYYY-MM-DD String giving the date
  of the transaction and memo is a String describing the transaction.

  Note that the API uses the word 'act' to refer to a transaction.

Our data model makes the following simplifying assumptions:

  + Each account has only a single holder; i.e. there are no
    "joint accounts."

  + Each account has an infinite overdraft; i.e. the balance can
    be negative without limit.

The params argument to API methods is an object specifying values for
the method parameters.  Note that the value of all parameters must be
String's.

Since most API methods operate on an individual account, the `params`
object usually contains an `id` property identifying the relevant
account.

All API methods return errors by returning an object having an errors
property specifying a list of error objects.  Each error is a object

  { message, options? } 

where message is a String specifying the error message and optional
options is an object.  In particular, options can specify property
'code' which is a String giving an error code.

Less verbosely, errors are returned as an object:

  { errors: [ { message: String, options?: { code?: String, ...} } ] } 

where { } indicates an object, [ ] indicates a list/array and ?
indicates optional.

The API documentation specifies errors by code.
  
*/

const DEFAULT_COUNT = 5;

export default function makeAccounts() {
  return new Accounts();
}
makeAccounts.DEFAULT_COUNT = DEFAULT_COUNT; //for testing

class Accounts {
  constructor() {
    this._accounts = [];
  }

  /** Return ID of a newly created account having holder ID set to
   *  params.holderId and zero balance.  When called, params must
   *  specify holderId.
   *  
   *  Error Codes: 
   *    BAD_REQ:     holderId not specified.
   */
  newAccount(params={}) {
    const account = this._account(params, true);
    if (account.errors) return account;
    this._accounts[account.id] = account;
    return account.id;
  }

  /** Return account for params.id.
   *  Error Codes: 
   *    BAD_REQ:     id not specified.
   *    NOT_FOUND:   no account having ID id.
   */
  account(params) { return this._account(params); }

  _account(params, isNew=false) {
    const errors = new AppErrors();
    const required = isNew ? 'holderId' : 'id';
    if (!params[required]) {
      const msg = `account ${required} must be provided`;
      return errors.add(msg, { code: 'BAD_REQ'});
    }
    else if (isNew) {
      return new Account(params.holderId);
    }
    else if (!this._accounts[params.id]) {
      const msg = `account "${params.id}" not found`;
      return errors.add(msg, { code: 'NOT_FOUND'});
    }
    else {
      return this._accounts[params.id];
    }
  }

  _dispatch(fn, params) {
    const account = this._account(params);
    if (account.errors) return account;
    if (!account[fn]) {
      return new AppErrors().add(`invalid method ${fn}`);
    }
    else {
      return account[fn](params);
    }
  }
  
}

class Account {
  constructor(holderId) {
    this.id = genId();
    this.holderId = holderId;
    this._acts = [];
  }

  /** Return object { id, holderId, balance } where id is account ID,
   *  holderId is ID of holder and balance is a Number giving the
   *  current account balance after the chronologically last
   *  transaction. 
   *
   *  Error Codes: None.
   */
  info(params={}) {
    return  {
      id: this.id,
      holderId: this.holderId,
      balance: this._balance(),
    };
  }

  /** Return ID of a newly created transaction.  When called, params must be 
   *  an object containing at least { amount, date, memo } where:
   * 
   *    amount is a string /^[-+]?\d+\.\d\d$/ representing a number, 
   *    date is a YYYY-MM-DD string representing a valid date
   *    memo is a non-empty string.
   *
   *  representing the properties of the transaction to be created.
   *
   *  Error Codes:
   *    BAD_REQ:     params does not specifytransaction amount, 
   *                 date or memo; or amount, date do not meet 
   *                 restrictions on format.
   */
  newAct(params={}) {
    const act = new Transaction(params);
    if (act.errors) return act;
    this._acts.push(act);
    this._acts.sort((act1, act2) => act1.compare(act2));
    return act.id;
  }

  /** Return list of transactions satisfying params for an account.
   *  The returned list is ordered by date in non-decreasing order;
   *  transactions with the same date are ordered in the order they
   *  were added to the account.  When called, params must specify
   *
   * { actId?, date?, memoText?, count?, index?, }
   *  
   *  The optional parameters which are used to filter the
   *  returned transactions include:
   *
   *    actId:       The transaction ID (if this is specified at most
   *                 one transaction will be returned).
   *    date:        A valid YYYY-MM-DD date string.  If specified, all 
   *                 returned transactions must have date equal to this value.
   *    memoText:    A substring which must occur within the memo
   *                 field of matching transactions; the matching 
   *                 must be case-insensitive.
   *    count:       A string specifying a non-negative integer giving 
   *                 the maximum number of returned transactions 
   *                 (defaults to DEFAULT_COUNT).
   *    index:       A string specifying a non-negative integer giving the
   *                 starting index of the first returned transaction in the
   *                 ordered list of transactions satisfying the rest
   *                 of the params (defaults to 0).
   *
   *  Each transaction is returned as
   * 
   *  { id, amount, date, memo }
   *
   *    id:      The ID of the transaction.
   *    amount:  A Number giving the amount for the transaction.
   *    date:    The YYYY-MM-DD date of the transaction.
   *    memo:    The memo associated with the transaction.
   *
   *  Error Codes:  
   *    BAD_REQ:     date, count or index are specified but do
   *                 not meet their requirements.
   */
  query(params={}) {
    let index = 0;
    let count = DEFAULT_COUNT;
    let date;
    let memo = params.memoText?.toLowerCase();
    const errors = new AppErrors();
    if (params.index) index = getPositiveInt(params.index, errors);
    if (params.count) count = getPositiveInt(params.count, errors);
    if (params.date) date = getDate(params.date, errors);
    if (errors.isError() > 0) return errors;
    const filterFn = a => {
      let ok = true;
      if (params.actId !== undefined) ok &&= a.id === params.actId;
      if (date !== undefined) ok &&= a.date === date;
      if (memo !== undefined) ok &&= a.memo.toLowerCase().indexOf(memo) >= 0;
      return ok;
    }
    let acts = this._acts.filter(filterFn);
    return acts.slice(index, index + count).map(a => a.view());
  }

  /**
   *  Return list of transactions for this account ordered by date in
   *  non-decreasing order; transactions with the same date are
   *  ordered in the order they were added to the account.  The
   *  transactions can be filtered by the following optional params:
   *
   *    fromDate:    A string specifying a YYYY-MM-DD giving
   *                 the earliest date for the returned transactions.
   *    toDate:      A string specifying a YYYY-MM-DD giving
   *                 the latest date for the returned transactions.
   * 
   *  Each transaction is returned as
   * 
   *  { id, amount, date, memo, balance }
   *
   *    id:      The ID of the transaction.
   *    amount:  A Number giving the amount for the transaction.
   *    date:    The YYYY-MM-DD date of the transaction.
   *    memo:    The memo associated with the transaction.
   *    balance: A Number giving the account balance 
   *             immediately after the transaction.
   *  Error Codes:  
   *    BAD_REQ:     fromDate or toDate are not valid dates.
   */
  statement(params={}) {
    let {fromDate, toDate} = params;
    const errors = new AppErrors();
    if (fromDate) fromDate = getDate(fromDate, errors);
    if (toDate) toDate = getDate(toDate, errors);
    if (errors.isError()) return errors;
    let fromIndex =
      fromDate ? this._acts.findIndex(a => a.date >= fromDate) : 0;
    if (fromIndex < 0) fromIndex = this._acts.length;
    let toIndex = toDate ? this._acts.findIndex(a => a.date > toDate) : -1;
    if (toIndex < 0) toIndex = this._acts.length;
    let cents0 = this._acts
      .slice(0, fromIndex)
      .reduce((acc, a) => acc + a.cents, 0);
    return this._acts
      .slice(fromIndex, toIndex)
      .map(a => Object.assign(a.view(), { balance: (cents0 += a.cents)/100 }));
  }

  _balance(endIndex) {
    return this._acts
      .slice(0, endIndex)
      .reduce((acc, a) => acc + a.cents, 0) / 100;
  }
}

class Transaction {
  constructor({amount: amountStr, date: dateStr, memo}) {
    const errors = new AppErrors();
    const cents = getCents(amountStr, errors);
    const date = getDate(dateStr, errors);
    memo = (memo?.trim().length > 0)
      ? memo.trim()
      : errors.add(`memo required`, { code: 'BAD_REQ' });
    if (errors.errors.length > 0) {
      return errors;
    }
    else {
      const id = genId();
      Object.assign(this, { id, cents, date, memo });
    }
  }

  view() {
    return ({
      id: this.id,
      amount: this.cents/100,
      date: this.date,
      memo: this.memo,
    });
  }
  
  compare(act) {
    return this.date < act.date ? -1 : this.date > act.date ? +1 : 0;
  }

}

