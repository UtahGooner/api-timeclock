import Debug from 'debug';
import {mysql2Pool} from 'chums-local-modules';
import {BaseEntry, BaseEntryAction, Entry, EntryAction} from "../types";
import {ResultSetHeader, RowDataPacket} from "mysql2";
import {isClockedIn, validateEntries} from "./utils.js";
import {ENTRY_TYPES} from "./settings.js";

const debug = Debug('chums:lib:timeclock:entry');



interface EntryActionRow extends EntryAction, RowDataPacket {
}

export async function loadEntryActions(idEntryList: number[] = []): Promise<EntryAction[]> {
    try {
        if (Array.isArray(idEntryList) === false || idEntryList.length === 0) {
            return [];
        }
        const query = `SELECT id,
                              idEntry,
                              type                AS actionType,
                              FROM_UNIXTIME(time) AS time,
                              ip,
                              notes,
                              timestamp
                       FROM timeclock.EntryAction
                       WHERE idEntry IN (:idEntryList)
                       ORDER BY id`;
        const params = {idEntryList};

        const [rows] = await mysql2Pool.query<EntryActionRow[]>(query, params);
        return rows.map(row => {
            return {
                ...row,
                notes: typeof row.notes === 'string' ? JSON.parse(row.notes || '{}') : row.notes
            }
        });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEntryActions()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error in loadEntryActions()'));
    }
}

interface EntryRow extends Entry, RowDataPacket {
}

interface LoadEntryProps {
    idEmployee: string | number,
    id?: string | number,
    idEntryType?: string | number,
}

export async function loadEmployeeEntry({idEmployee, id}: LoadEntryProps): Promise<Entry|null> {
    try {
        if (id === 0) {
            return null;
        }
        if (!id || !+id) {
            return Promise.reject(new Error('Invalid entry ID'));
        }
        const [entry] = await loadEntries(idEmployee, [Number(id)]);
        return entry || null;
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("loadEmployeeEntry()", err.message);
            return Promise.reject(err);
        }
        debug("loadEmployeeEntry()", err);
        return Promise.reject(new Error('Error in loadEmployeeEntry()'));
    }
}


interface LatestEntryRow extends RowDataPacket {
    id: number,
}

export async function loadEmployeeLatestEntry({
                                                  idEmployee,
                                                  idEntryType = ENTRY_TYPES.TIMECLOCK
                                              }: LoadEntryProps): Promise<Entry | null> {
    try {
        const query = `SELECT e.id
                       FROM timeclock.Entry e
                            INNER JOIN (
                                       SELECT MIN(StartDate) AS StartDate,
                                              MAX(EndDate)   AS EndDate
                                       FROM timeclock.PayPeriods
                                       WHERE completed = 0
                                         AND StartDate < UNIX_TIMESTAMP()
                                       ) payPeriods
                                       ON e.EntryDate BETWEEN payPeriods.StartDate
                                           AND payPeriods.EndDate
                       WHERE deleted = 0
                         AND idEmployee = :idEmployee
                         AND idEntryType = :idEntryType
                         AND EntryDate < UNIX_TIMESTAMP()
                       ORDER BY EntryDate DESC
                       LIMIT 1`;
        const params = {idEmployee, idEntryType};
        const [rows] = await mysql2Pool.query<LatestEntryRow[]>(query, params);
        if (!rows.length) {
            return null;
        }
        const {id} = rows[0];
        const [entry] = await loadEntries(idEmployee, [id]);
        return entry;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEmployeeLatestEntry()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadEmployeeLatestEntry()'));
    }
}


export async function saveEntryAction(entryAction: BaseEntryAction): Promise<EntryAction> {
    try {
        const {idEntry, actionType, time, ip, notes} = entryAction;
        const sql = `INSERT INTO timeclock.EntryAction(idEntry, type, time, ip, notes)
                     VALUES (:idEntry, :actionType, UNIX_TIMESTAMP(:time), :ip, :notes)`;
        const args = {idEntry, actionType, time, ip, notes: JSON.stringify(notes || {})};
        const [result] = await mysql2Pool.query<ResultSetHeader>(sql, args);
        const [action] = await loadEntryActions([result.insertId]);
        return action;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("saveEntryAction()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveEntryAction()'));
    }
}


export async function saveNewEntry(entry: BaseEntry): Promise<Entry> {
    try {
        if (!entry.idEmployee) {
            return Promise.reject(new Error('Invalid employee'));
        }
        if (!entry.EntryDate) {
            entry.EntryDate = new Date().toISOString();
        }

        const {idEmployee, idEntryType, idUser, EntryDate, Duration, Note} = entry;
        const query = `INSERT INTO timeclock.Entry (idEmployee, idEntryType, idUser, EntryDate, Duration, Note)
                       VALUES (:idEmployee, :idEntryType, :idUser, UNIX_TIMESTAMP(:EntryDate), :Duration, :Note)`;
        const args = {idEmployee, idEntryType, EntryDate, idUser, Duration, Note}
        const [result] = await mysql2Pool.query<ResultSetHeader>(query, args);
        const [_entry] = await loadEntries(idEmployee, [result.insertId], true);
        return _entry;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("clockIn()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveNewEntry()'));
    }
}

export async function saveEntry(entry: Entry): Promise<Entry> {
    try {
        const {id, idEmployee, idEntryType, idUser, EntryDate, Duration, Note} = entry;
        if (!id) {
            return await saveNewEntry(entry);
        }
        if (!EntryDate) {
            return Promise.reject(new Error('Invalid entry date'));
        }
        const sql = `UPDATE timeclock.Entry
                     SET idEntryType = :idEntryType,
                         EntryDate   = UNIX_TIMESTAMP(:EntryDate),
                         Duration    = :Duration,
                         Note        = :Note
                     WHERE id = :id`;
        await mysql2Pool.query(sql, {id, idEntryType, EntryDate, Duration, Note: Note || ''});
        const [_entry] = await loadEntries(idEmployee, [id]);
        return _entry;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("clockIn()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveEntry()'));
    }
}


interface EntryRow extends Entry, RowDataPacket {
}

export async function loadPayPeriodEntries(idEmployee: string | number, idPayPeriod: string | number): Promise<Entry[]> {
    try {
        const query = `SELECT e.id,
                              pp.id                      AS idPayPeriod,
                              e.idEmployee,
                              e.idEntryType,
                              e.idUser,
                              FROM_UNIXTIME(e.EntryDate) AS EntryDate,
                              IF(
                                          YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1) =
                                          YEARWEEK(FROM_UNIXTIME(pp.StartDate), 1)
                                  , 0, 1)                AS Week,
                              e.Duration,
                              e.Note,
                              e.EmployeeApproved,
                              e.EmployeeApprovalTime,
                              e.Approved,
                              e.ApprovalTime,
                              e.ApprovedBy,
                              e.deleted,
                              e.deletedBy,
                              e.timestamp
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.PayPeriods pp
                                       ON pp.id = :idPayPeriod AND e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                       WHERE e.idEmployee = :idEmployee
                       ORDER BY EntryDate, idEntryType`;
        const params = {idEmployee, idPayPeriod};

        const [rows] = await mysql2Pool.query<EntryRow[]>(query, params);
        const entries = await loadEntriesHelper(rows);
        return await validateEntries(entries);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodEntries()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadPayPeriodEntries'));
    }
}

async function loadEntriesHelper(rows: Entry[]): Promise<Entry[]> {
    try {
        if (!rows.length) {
            return [];
        }
        const idEntryList = rows.map(row => row.id || 0).filter(id => !!id);
        const entryActions = await loadEntryActions(idEntryList);
        return rows.map(row => {
            const actions = entryActions.filter(action => action.idEntry === row.id);
            return {
                ...row,
                errors: [],
                actions,
                EmployeeApproved: !!row.EmployeeApproved,
                Approved: !!row.Approved,
                deleted: !!row.deleted,
                isClockedIn: !row.deleted && isClockedIn(actions)
            }
        });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEntriesHelper()", err.message);
            return Promise.reject(err);
        }
        debug("loadEntriesHelper()", err);
        return Promise.reject(new Error('Error in loadEntriesHelper()'));
    }
}

export async function loadEntries(idEmployee: number | string, entryIDs: number[], skipValidation:boolean = false): Promise<Entry[]> {
    try {
        if (entryIDs.length === 0) {
            return [];
        }
        const query = `SELECT e.id,
                              pp.id                      AS idPayPeriod,
                              e.idEmployee,
                              e.idEntryType,
                              e.idUser,
                              FROM_UNIXTIME(e.EntryDate) AS EntryDate,
                              IF(
                                          YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1) =
                                          YEARWEEK(FROM_UNIXTIME(pp.StartDate), 1)
                                  , 0, 1)                AS Week,
                              e.Duration,
                              e.Note,
                              e.EmployeeApproved,
                              e.EmployeeApprovalTime,
                              e.Approved,
                              e.ApprovalTime,
                              e.ApprovedBy,
                              e.deleted,
                              e.deletedBy,
                              e.timestamp
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.PayPeriods pp
                                       ON e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                       WHERE e.idEmployee = :idEmployee
                         AND e.id IN (:entryIDs)
                       ORDER BY EntryDate, idEntryType`;
        const params = {idEmployee, entryIDs};

        const [rows] = await mysql2Pool.query<EntryRow[]>(query, params);
        const entries = await loadEntriesHelper(rows);
        if (skipValidation) {
            return entries;
        }
        return await validateEntries(entries);
    } catch (err: unknown) {
        if (err instanceof Error) {
        }
        debug("loadEntries()", err);
        return Promise.reject(new Error('Error in loadEntries()'));
    }
}
