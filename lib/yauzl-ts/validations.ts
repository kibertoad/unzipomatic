export function validateFileName(fileName: string) {
  if (fileName.indexOf('\\') !== -1) {
    return `invalid characters in fileName: ${fileName}`
  }
  if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) {
    return `absolute path: ${fileName}`
  }
  if (fileName.split('/').indexOf('..') !== -1) {
    return `invalid relative path: ${fileName}`
  }
  // all good
  return null
}
