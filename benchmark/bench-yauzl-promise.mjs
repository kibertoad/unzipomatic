import yauzl from 'yauzl-promise';

let filesRead = 0;

const start = performance.now();
yauzl.open('./test.zip').then(async zipFile => {
  for await (const entry of zipFile) {
    filesRead++;
  }
  console.log(`Files Read: ${filesRead}`);
  console.log(`Took: ${performance.now() - start}ms`);
  console.log(`Memory: ${process.memoryUsage.rss() / 1024 / 1024}MB`);
});
