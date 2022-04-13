import Debug from 'debug';
import {mysql2Pool, handleUpload, FormidableFile} from "chums-local-modules";
import {OkPacket, RowDataPacket} from "mysql2";
import {Request, Response} from 'express'
import {rename} from 'fs/promises';
import {formatISO9075, parseISO} from "date-fns";
import {JobPosting} from "../types";

const debug = Debug('chums:lib:jobs:job-postings');

const ROOT_PATH = '/var/www';
const BASE_PATH = ROOT_PATH + '/common/pdf/jobs';
const UPLOAD_PATH = BASE_PATH + '/temp';

interface loadJobPostingsProps {
    id?: number
}
interface JobPostingRow extends JobPosting, RowDataPacket {}

async function loadJobPostings({id}: loadJobPostingsProps = {}): Promise<JobPosting[]> {
    try {
        const sql = `SELECT id,
                            title,
                            enabled,
                            description,
                            datePosted,
                            jobLocation,
                            validThrough,
                            baseSalary,
                            employmentType,
                            educationalRequirements,
                            experienceRequirements,
                            experienceInPlaceOfEducation,
                            emailRecipient,
                            applicationInstructions,
                            filename,
                            timestamp
                     FROM timeclock.JobPostings
                     WHERE (IFNULL(:id, '') = id OR :id IS NULL)
                     ORDER BY id`;
        const [rows] = await mysql2Pool.query<JobPostingRow[]>(sql, {id});
        if (!Array.isArray(rows)) {
            return [];
        }
        rows.forEach(row => {
            row.enabled = !!row.enabled;
            row.experienceInPlaceOfEducation = !!row.experienceInPlaceOfEducation;
            row.baseSalary = typeof row.baseSalary === 'string' ? JSON.parse(row.baseSalary) : null;
        });
        return rows as JobPosting[];
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("loadJobPostings()", err.message);
            return Promise.reject(err);
        }
        debug("loadJobPostings()", err);
        return Promise.reject(err);
    }
}

function mysqlDate(value:Date|string|null):string|null {
    return !!value
        ? formatISO9075(parseISO(value instanceof Date ? value.toISOString() : value), {representation: 'date'})
        : null;
}
async function updateJobPosting(props: JobPosting): Promise<JobPosting[]> {
    try {
        const {
            id,
            title,
            enabled,
            description,
            datePosted,
            jobLocation,
            validThrough,
            baseSalary,
            employmentType,
            educationalRequirements,
            experienceRequirements,
            experienceInPlaceOfEducation,
            filename,
            emailRecipient,
            applicationInstructions,
        } = props;
        const sql = `UPDATE timeclock.JobPostings
                     SET title                        = :title,
                         enabled                      = :enabled,
                         description                  = :description,
                         datePosted                   = :datePosted,
                         jobLocation                  = :jobLocation,
                         validThrough                 = :validThrough,
                         baseSalary                   = :baseSalary,
                         employmentType               = :employmentType,
                         educationalRequirements      = :educationalRequirements,
                         experienceRequirements       = :experienceRequirements,
                         experienceInPlaceOfEducation = :experienceInPlaceOfEducation,
                         filename                     = :filename,
                         emailRecipient               = :emailRecipient,
                         applicationInstructions      = :applicationInstructions
                     WHERE id = :id`
        const values = {
            id, title, enabled, description,
            datePosted: mysqlDate(datePosted),
            jobLocation,
            validThrough: mysqlDate(validThrough),
            baseSalary: JSON.stringify(baseSalary),
            employmentType, educationalRequirements, experienceRequirements, experienceInPlaceOfEducation,
            emailRecipient, filename, applicationInstructions
        };

        // debug('updateJobPosting()', values);
        await mysql2Pool.query(sql, values);
        return await loadJobPostings({id});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("updateJobPosting()", err.message);
            return Promise.reject(err);
        }
        debug("updateJobPosting()", err);
        return Promise.reject(err);
    }
}


async function saveJobPosting(props: JobPosting): Promise<JobPosting[]> {
    try {
        const {
            id,
            title,
        } = props;
        if (id) {
            return await updateJobPosting(props);
        }
        const sql = `INSERT INTO timeclock.JobPostings (title)
                     VALUES (:title)`;
        const [response] = await mysql2Pool.query(sql, {title});
        const {insertId} = response as OkPacket;
        return await updateJobPosting({...props, id: insertId})
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("saveJobPosting()", err.message);
            return Promise.reject(err);
        }
        debug("saveJobPosting()", err);
        return Promise.reject(err);
    }
}

interface DeleteJobPostingProps {
    id?: number,
}
async function deleteJobPosting({id}:DeleteJobPostingProps):Promise<JobPosting[]> {
    try {
        if (!id) {
            return await loadJobPostings();
        }
        const sql = `DELETE FROM timeclock.JobPostings where id = :id`;
        await mysql2Pool.query(sql, {id});
        return await loadJobPostings();
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("deleteJobPosting()", err.message);
            return Promise.reject(err);
        }
        debug("deleteJobPosting()", err);
        return Promise.reject(err);
    }
}

export const getJobPostings = async (req: Request, res: Response) => {
    try {
        const postings = await loadJobPostings(req.params);
        if (req.params.id && postings.length === 0) {
            return res.status(404).json({error: 'Posting not found'});
        }
        res.json({postings});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("getPostings()", err.message);
            res.json({error: err.message});
        }
        debug("getPostings()", err);
        res.json({error: err});
    }
}

const filterActive = (posting: JobPosting, now: Date = new Date()): boolean => {
    return !!posting.enabled
        && !!posting.datePosted
        && new Date(posting.datePosted) < now
        && (!posting.validThrough || new Date(posting.validThrough) > now);
}

export const getActiveJobPostings = async (req: Request, res: Response) => {
    try {
        const allowOrigin = [
            'https://chums.com',
            'https://chumsinc.myshopify.com',
            'http://localhost:8080'
        ]
        const list = await loadJobPostings(req.params);
        const {preview} = req.query;
        const now = new Date();
        const postings = preview === '1' ? list : list.filter(posting => filterActive(posting, now));
        if (allowOrigin.indexOf(req.headers.origin || '') !== -1) {
            res.set('access-control-allow-origin', req.headers.origin);
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        }
        res.json({postings});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("getPostings()", err.message);
            res.json({error: err.message});
        }
        debug("getPostings()", err);
        res.json({error: err});
    }
}

export const postJobPosting = async (req: Request, res: Response) => {
    try {
        const postings = await saveJobPosting({...req.params, ...req.body});
        res.json({postings});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("postJobPosting()", err.message);
            res.json({error: err.message});
        }
        debug("postJobPosting()", err);
        res.json({error: err});
    }
}

export const postJobDescriptionFile = async (req: Request, res: Response) => {
    try {
        const file:FormidableFile = await handleUpload(req, {uploadPath: UPLOAD_PATH});
        const filename = `${BASE_PATH}/${file.originalFilename}`;
        await rename(file.filepath, filename);
        const [posting] = await loadJobPostings(req.params);
        const postings = await updateJobPosting({...posting, filename: file.originalFilename || file.newFilename});
        res.json({postings});
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("postJobDescriptionFile()", err.message);
            res.json({error: err.message});
        }
        debug("postJobDescriptionFile()", err);
        res.json({error: err});
    }
}

export const delJobPosting = async (req:Request, res: Response) => {
    try {
        const postings = await deleteJobPosting(req.params);
        res.json({postings});
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("delJobPosting()", err.message);
            res.json({error: err.message})
        }
        debug("delJobPosting()", err);
        res.json({error: err})
    }
}
