import yarnZip from '@yarnpkg/libzip';

const start = performance.now();
const zipFile = new yarnZip.ZipFS('./test.zip');
let filesRead = 0;

zipFile.getAllFiles().forEach(file => {
  filesRead++;
});

console.log(`Files Read: ${filesRead}`);
console.log(`Took: ${performance.now() - start}ms`);
console.log(`Memory: ${process.memoryUsage.rss() / 1024 / 1024}MB`);