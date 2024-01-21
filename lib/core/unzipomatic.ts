import {Readable} from "stream";

export type UnzipOptions = {
    // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type TargetFileMetadata = {
    fullPath: string
    fileSize: number
}

// ToDo
export type FileGenerator = {}

export function unzipToFilesystem(source: SourceType, targetDir: string, options: UnzipOptions): Promise<TargetFileMetadata>

/**
 * Used to iterate over multiple files in an archive
 */
export function unzipToGenerator(source: SourceType, targetDir: string, options: UnzipOptions): Promise<FileGenerator>

/**
 * Used to extract single-file archive
 */
export function unzipToReadable(source: SourceType, options: UnzipOptions): Promise<Readable>

// TBD
// Do we need to support filters for extracting just a subset of files?
//