const mammoth = require('../node_modules/mammoth');
mammoth.extractRawText({ path: 'D:/project/agent-01/doc/食用 · 清言 API.docx' })
  .then(r => console.log(r.value));
