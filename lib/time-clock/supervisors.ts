import Debug from 'debug';
import {mysql2Pool} from "chums-local-modules";
import {Supervisor} from "../types";
import {RowDataPacket} from "mysql2";
import {Request, Response} from "express";


const debug = Debug('chums:lib:time-clock:supervisors');

interface SupervisorRow extends Supervisor, RowDataPacket {
}

export const loadSupervisors = async (): Promise<Supervisor[]> => {
    try {
        const sql = `SELECT DISTINCT userid AS id, name
                     FROM users.vw_usergroups
                     WHERE role IN ('tcsupervisor', 'tcadmin', 'root')
                     ORDER BY name`;
        const [rows] = await mysql2Pool.query<SupervisorRow[]>(sql);
        return rows;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadSupervisors()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Error in loadSupervisors'));
    }
}

export const getSupervisors = async (req: Request, res: Response) => {
    try {
        const supervisors = await loadSupervisors();
        res.json({supervisors});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getSupervisors()", err.message);
            return res.json({error: 'Unknown error in getSupervisors'});
        }
    }
}

interface SupervisorRow extends Supervisor, RowDataPacket {}
export async function loadEmployeeSupervisors(id: number | string):Promise<Supervisor[]> {
    try {
        const query = `SELECT s.id, s.idUser, u.name
                       FROM timeclock.Employee e
                            INNER JOIN timeclock.Supervision s
                                       ON s.idEmployee = e.id
                            INNER JOIN users.users u
                                       ON u.id = s.idUser
                            INNER JOIN (
                                       SELECT DISTINCT userid
                                       FROM users.vw_usergroups
                                       WHERE role IN ('tcsupervisor', 'tcadmin')) ur
                                       ON ur.userid = u.id
                       WHERE s.idEmployee = :id
                         AND u.active = 1`;
        const [rows] = await mysql2Pool.query<SupervisorRow[]>(query, {id});
        return rows;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadSupervisors()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadEmployeeSupervisors()'));
    }
}

export const getEmployeeSupervisors = async (req: Request, res: Response) => {
    try {
        const supervisors = await loadEmployeeSupervisors(req.params.idEmployee);
        res.json({supervisors});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getEmployeeSupervisors()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getEmployeeSupervisors'});
    }
};

export async function addSupervisor(idUser: number|string, idEmployee: number|string) {
    try {
        const sql = `INSERT IGNORE INTO timeclock.Supervision (idUser, idEmployee)
                     VALUES (:idUser, :idEmployee)`;
        const args = {idUser, idEmployee};
        await mysql2Pool.query(sql, args);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("setSupervisor()", err.message);
            return Promise.reject(err);
        }
        debug("setSupervisor()", err);
        return Promise.reject(new Error('Error in setSupervisor()'));
    }
}

export async function removeSupervisor(idUser: number, idEmployee: number) {
    try {
        const sql = `DELETE
                     FROM timeclock.Supervision
                     WHERE idUser = :idUser
                       AND idEmployee = :idEmployee`;
        const args = {idUser, idEmployee};
        await mysql2Pool.query(sql, args);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("removeSupervisor()", err.message);
            return Promise.reject(err);
        }
        debug("removeSupervisor()", err);
        return Promise.reject(new Error('Error in removeSupervisor()'));
    }
}

export const postSupervisor = async  (req:Request, res:Response) => {
    try {
        await addSupervisor(req.params.idUser, req.params.idEmployee);
        const supervisors = await loadEmployeeSupervisors(req.params.idEmployee);
        res.json({supervisors});
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("postSupervisor()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in postSupervisor'});
    }
}

export const deleteSupervisor = async  (req:Request, res:Response) => {
    try {
        await addSupervisor(req.params.idUser, req.params.idEmployee);
        const supervisors = await loadEmployeeSupervisors(req.params.idEmployee);
        res.json({supervisors});
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("deleteSupervisor()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in deleteSupervisor'});
    }
}
