import fs from 'fs';
let code = fs.readFileSync('src/index.ts', 'utf-8');
if(!code.includes('app.use((req, res, next)')) {
  code = code.replace("app.listen(PORT", "app.use((req, res, next) => {\n  console.log('404 NOT FOUND:', req.method, req.url);\n  res.status(404).send('Not Found');\n});\n\napp.listen(PORT");
  fs.writeFileSync('src/index.ts', code);
}
