import {Readable} from "node:stream";
import { fromBuffer } from '../yauzl-ts/inputProcessors'
import { ZipFile } from '../yauzl-ts/ZipFile'
import { RandomAccessReader } from '../yauzl-ts/RandomAccessReader'
import { mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { Entry } from '../yauzl-ts/Entry'


export type UnzipOptions = {
    // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type TargetFileMetadata = {
    fullPath: string
    fileSize: number
}

// ToDo
export type FileGenerator = Generator<Entry, void, void>

export async function unzipToFilesystem(source: SourceType, targetDir: string, options: UnzipOptions): Promise<TargetFileMetadata> {
    if (!Buffer.isBuffer(source)) {
        throw new Error('Only buffer is currently supported')
    }

    const result = await new Promise(async (resolve, reject) => {
        const zipfile = await new Promise<ZipFile<RandomAccessReader>>((resolve, reject) => {
            fromBuffer(source, { lazyEntries: true }, (err, result) => {
                if (err) {
                    return reject(err)
                }
                return resolve(result!)
            })
        })

        zipfile.readEntry();
        zipfile.on('entry', async (entry: Entry) => {
            // Directory file names end with '/'
            if (/\/$/.test(entry.fileName)) {
                // Directory: create if doesn't exist
                const directoryPath = join(targetDir, entry.fileName)
                await mkdir(directoryPath, { recursive: true })
                zipfile.readEntry();
            } else {
                // File: extract
                zipfile.openReadStream(entry, { decrypt: entry.isEncrypted() ? false : null }, async (err, readStream) => {
                    if (err) throw err;
                    const filePath = join(targetDir, entry.fileName);
                    await mkdir(dirname(filePath), { recursive: true })
                    readStream.pipe(createWriteStream(filePath));
                    readStream.on('end', () => {
                        zipfile.readEntry();
                    });
                });
            }

        });
        zipfile.on('end', () => {
            resolve(undefined)
        })
        zipfile.on('error', (err) => {
            reject(err)
        })
    })

    return {
        fullPath: 'dummy',
        fileSize: 444,
    }
}

/**
 * Used to iterate over multiple files in an archive
 */
export function unzipToReadableGenerator(source: SourceType, options: UnzipOptions): Promise<FileGenerator>

/**
 * Used to extract a single-file archive
 */
export function unzipToReadable(source: SourceType, options: UnzipOptions): Promise<Readable>

/**
 * Used to extract a single-file archive
 */
export function unzipToBuffer(source: SourceType, options: UnzipOptions): Promise<Buffer>

// TBD
// Do we need to support filters for extracting just a subset of files?
//
