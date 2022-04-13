import Debug from 'debug';
import numeral from 'numeral';
import {addResultToExcelSheet, buildWorkBook, mysql2Pool, parseDataForAOA, WorkBookSheets} from "chums-local-modules";
import {PayPeriodSSEarnings, PayPeriodSSRecord} from "../types";
import {RowDataPacket} from "mysql2";
import Decimal from 'decimal.js-light';
import {Request, Response} from "express";
import {loadPayPeriods} from "./pay-periods.js";
import {utils} from 'xlsx';

const debug = Debug('chums:lib:time-clock:pay-period-spreadsheets');

const oneHour = 3600;
const fortyHours = 40 * oneHour;

const colNames = {
    EmployeeName: "Name",
    Department: "Department",
    EmployeeNumber: "Employee No",
    Hours_000001: "Reg (01)",
    Hours_000002: "OT (02)",
    Hours_000003: "Hol (03)",
    Hours_000004: "PL (04)",
    Hours_000011: "B/JD (11)",
    Hours_ASSIST: "CHUMS Med Assist",
    // Hours_FMLA67: 'FMLA 67%',
    // Hours_FMLA10: "FMLA 100%",
    EmployeeApprovalTime: "Employee Approval Time",
    SupervisorApprovalTime: "Supervisor Approval Time",
    SupervisorName: "Approved By",
};

const formattedSeconds = (seconds:number|string = 0, format:string = 'hhmm'):string|number => {
    if (typeof seconds === 'string') {
        seconds = Number(seconds);
    }
    switch (format) {
    case 'hhmm':
        if (seconds === 0) {
            return ''
        }
        const hours = Math.floor(seconds / oneHour);
        const minutes = (seconds % oneHour) / 60;
        return `${numeral(hours).format('00')}:${numeral(minutes).format('00.000')}`;

    case 'hhh':
        return seconds / oneHour;
    default:
        return seconds;
    }
}
interface PayPeriodResultObject {
    [key:string]: PayPeriodSSRecord
}
interface PayPeriodSSRow extends PayPeriodSSRecord, RowDataPacket {}
export interface LoadPayPeriodSSEntriesProps {
    idPayPeriod: number|string,
    format?: string,
}
export async function loadPayPeriodSSEntries({idPayPeriod, format = 'hhmm'}:LoadPayPeriodSSEntriesProps):Promise<PayPeriodSSRecord[]> {
    try {
        const emptyPPEarnings:PayPeriodSSEarnings = {
            Hours_000001: 0,
            Hours_000002: 0,
            Hours_000003: 0,
            Hours_000004: 0,
            Hours_000011: 0,
            Hours_ASSIST: 0,
            Hours_FMLA67: 0,
            Hours_FMLA10: 0,
        }
        const query = `SELECT ee.EmployeeKey,
                              CONCAT(ee.FirstName, ' ', ee.LastName)        AS EmployeeName,
                              ee.Department,
                              ee.EmployeeNumber,
                              ee.PayMethod,
                              SUM(IF(et.MASCode = '000001', e.Duration, 0)) AS Hours_000001,
                              SUM(IF(et.MASCode = '000002', e.Duration, 0)) AS Hours_000002,
                              SUM(IF(et.MASCode = '000003', e.Duration, 0)) AS Hours_000003,
                              SUM(IF(et.MASCode = '000004', e.Duration, 0)) AS Hours_000004,
                              SUM(IF(et.MASCode = '000011', e.Duration, 0)) AS Hours_000011,
                              SUM(IF(et.MASCode = 'ASSIST', e.Duration, 0)) AS Hours_ASSIST,
                              SUM(IF(et.MASCode = 'FMLA67', e.Duration, 0)) AS Hours_FMLA67,
                              SUM(IF(et.MASCode = 'FMLA10', e.Duration, 0)) AS Hours_FMLA10,
                              MAX(e.EmployeeApprovalTime)                   AS EmployeeApprovalTime,
                              MAX(e.ApprovalTime)                           AS SupervisorApprovalTime,
                              GROUP_CONCAT(DISTINCT u.name)                 AS SupervisorName,
                              YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1)          AS WeekNumber,
                              SUM(e.Duration)                               AS seconds
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.EmployeeLink ee
                                       ON ee.id = e.idEmployee
                            INNER JOIN timeclock.EntryType et
                                       ON et.id = e.idEntryType
                            INNER JOIN (
                                       SELECT StartDate, EndDate
                                       FROM timeclock.PayPeriods
                                       WHERE id = :idPayPeriod) pp
                            LEFT JOIN  users.users u
                                       ON e.ApprovedBy = u.id
                       WHERE e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                         AND (ee.EmployeeStatus = 'A' OR (
                               (ISNULL(ee.TerminationDate) OR pp.startDate < UNIX_TIMESTAMP(ee.TerminationDate))
                               AND pp.EndDate > UNIX_TIMESTAMP(ee.HireDate)))
                         AND e.deleted = 0
                       GROUP BY EmployeeKey, EmployeeName, ee.Department, ee.EmployeeNumber,
                                YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1)
                       ORDER BY ee.Department, ee.EmployeeNumber, WeekNumber`;
        const data = {idPayPeriod};
        const [rows] = await mysql2Pool.query<PayPeriodSSRow[]>(query, data);
        const employees:PayPeriodResultObject = {};

        rows.forEach(row => {
            const {
                EmployeeKey,
                EmployeeName,
                Department,
                EmployeeNumber,
                PayMethod,
                EmployeeApprovalTime,
                SupervisorApprovalTime,
                SupervisorName
            } = row;

            if (!employees[EmployeeKey]) {
                employees[EmployeeKey] = {
                    EmployeeKey,
                    EmployeeName,
                    Department,
                    EmployeeNumber,
                    PayMethod,
                    EmployeeApprovalTime,
                    SupervisorApprovalTime,
                    SupervisorName,
                    ...emptyPPEarnings,
                }
            }

            let Hours_000001 = Number(row.Hours_000001);

            if (Hours_000001 > 144000) {
                employees[EmployeeKey].Hours_000002 = new Decimal(employees[EmployeeKey].Hours_000002).add(Hours_000001 - fortyHours).toString();
                employees[EmployeeKey].Hours_000001 = new Decimal(employees[EmployeeKey].Hours_000001).add(fortyHours).toString();
            } else {
                employees[EmployeeKey].Hours_000001 = new Decimal(employees[EmployeeKey].Hours_000001).add(Hours_000001).toString();
            }

            employees[EmployeeKey].Hours_000003 = new Decimal(employees[EmployeeKey].Hours_000003).add(row.Hours_000003).toString();
            employees[EmployeeKey].Hours_000004 = new Decimal(employees[EmployeeKey].Hours_000004).add(row.Hours_000004).toString();
            employees[EmployeeKey].Hours_000011 = new Decimal(employees[EmployeeKey].Hours_000011).add(row.Hours_000011).toString();
            employees[EmployeeKey].Hours_ASSIST = new Decimal(employees[EmployeeKey].Hours_ASSIST).add(row.Hours_ASSIST).toString();
            employees[EmployeeKey].Hours_FMLA67 = new Decimal(employees[EmployeeKey].Hours_FMLA67).add(row.Hours_FMLA67).toString();
            employees[EmployeeKey].Hours_FMLA10 = new Decimal(employees[EmployeeKey].Hours_FMLA10).add(row.Hours_FMLA10).toString();

            employees[EmployeeKey].EmployeeApprovalTime = EmployeeApprovalTime;
            employees[EmployeeKey].SupervisorApprovalTime = SupervisorApprovalTime;
            employees[EmployeeKey].SupervisorName = SupervisorName;
        });

        return Object.keys(employees).map(key => employees[key])
            .map(employee => {
                return {
                    ...employee,
                    Hours_000001: formattedSeconds(employee.Hours_000001, format),
                    Hours_000002: formattedSeconds(employee.Hours_000002, format),
                    Hours_000003: formattedSeconds(employee.Hours_000003, format),
                    Hours_000004: formattedSeconds(employee.Hours_000004, format),
                    Hours_000011: formattedSeconds(employee.Hours_000011, format),
                    Hours_ASSIST: formattedSeconds(employee.Hours_ASSIST, format),
                    Hours_FMLA67: formattedSeconds(employee.Hours_FMLA67, format),
                    Hours_FMLA10: formattedSeconds(employee.Hours_FMLA10, format),
                }
            });

    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodSSEntries()", err.message);
            return Promise.reject(err);
        }
        debug('loadPayPeriodSSEntries()',err);
        return Promise.reject(new Error('Error in loadPayPeriodSSEntries()'));

    }
}

export async function getPayPeriodSSData(req:Request, res:Response) {
    try {
        const [payPeriod] = await loadPayPeriods(req.params.idPayPeriod);
        if (!payPeriod) {
            return res.status(404).json({error: 'Pay period not found'});
        }
        const params:LoadPayPeriodSSEntriesProps = {
            idPayPeriod: req.params.idPayPeriod,
            format: req.query.format as string,
        }
        const entries = await loadPayPeriodSSEntries(params);
        res.json({payPeriod, entries});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("getExport()", err.message);
            return res.json({error: err.message});
        }
        debug("getExport()", err);
        res.json({error: 'Unknown error in getPayPeriodSSData()'});
    }
}


export async function getPayPeriodSpreadSheet(req:Request, res:Response) {
    try {
        const [payPeriod] = await loadPayPeriods(req.params.idPayPeriod);
        if (!payPeriod) {
            res.json({error: 'Pay period not found'});
        }

        const params:LoadPayPeriodSSEntriesProps = {
            idPayPeriod: req.params.idPayPeriod,
            format: req.query.format as string,
        }
        const entries = await loadPayPeriodSSEntries(params) as PayPeriodSSRow[];
        const ppRows = [['Start', payPeriod.startDate], ['End', payPeriod.endDate]];
        const sheet1 = utils.aoa_to_sheet(ppRows);
        const sheet = addResultToExcelSheet(sheet1, parseDataForAOA(entries, colNames, true), {origin: 4});

        let sheetName = `PayPeriod-${req.params.id}`;
        let sheets:WorkBookSheets = {};
        sheets[sheetName] = sheet;
        const workbook = buildWorkBook(sheets, {bookType: 'xlsx', bookSST: true, type: 'buffer', compression: true})
        const filename = `PayPeriod-${req.params.idPayPeriod}.xlsx`
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[\s]+/g, '_')}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(workbook);
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("getPayPeriodSpreadSheet()", err.message);
            return res.json({error: err.message});
        }
        debug("getPayPeriodSpreadSheet()", err);
        return res.json({error: 'Unknown error in getPayPeriodSpreadSheet()'});
    }
}


