const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

const tempStorageRoot = path.join(os.tmpdir(), `safespeak-microeducation-${process.pid}`);

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/safespeak-test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'b'.repeat(32);
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.MICRO_EDUCATION_IMAGE_STORAGE_PATH = tempStorageRoot;
process.env.MICRO_EDUCATION_S3_BUCKET = 'test-microeducation-bucket';
process.env.MICRO_EDUCATION_S3_PREFIX = 'microeducation-test';

const { S3Client } = require('@aws-sdk/client-s3');
const { AuditLogModel } = require('../src/modules/audit/audit.model.ts');
const { MicroEducationModel } = require('../src/modules/microeducation/microeducation.model.ts');
const {
  createMicroEducation,
  getMicroEducationImage,
  listPublicMicroEducation,
  updateMicroEducation
} = require('../src/modules/microeducation/microeducation.service.ts');

const objectId = '0123456789abcdef01234567';
const baseInput = {
  title: 'Recognizing Phishing Emails',
  summary: 'Learn safer first steps for suspicious email messages.',
  readTimeLabel: '4 min read',
  tag: 'Scam',
  cta: 'Review steps',
  detailHeading: 'Check before you click.',
  detailSummary: 'Pause before using unexpected links.',
  detailBody: 'Keep the message and check the sender before taking action.',
  detailTakeaway: 'A short pause can prevent account compromise.',
  imageAlt: 'Email safety illustration',
  tone: 'blue',
  chips: ['safety'],
  duration: 'quick',
  format: 'guide',
  status: 'published',
  sortOrder: 0,
  views: 0
};

const imageFile = {
  originalname: 'phishing.png',
  mimetype: 'image/png',
  size: 12,
  buffer: Buffer.from('image-bytes')
};

const makeDocument = (overrides = {}) => ({
  _id: { toString: () => objectId },
  ...baseInput,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  ...overrides
});

test('public microeducation list returns a direct signed S3 imagePath for S3 records', async (t) => {
  t.mock.method(AuditLogModel, 'create', async () => ({}));
  t.mock.method(MicroEducationModel, 'find', () => ({
    sort: () => ({
      lean: async () => [
        makeDocument({
          imageStorageProvider: 's3',
          imageStorageKey: 'microeducation-test/2026-07-01/example.png',
          imageOriginalFileName: 'example.png',
          imageMimeType: 'image/png',
          imageSizeBytes: 123,
          imageS3Bucket: 'test-microeducation-bucket',
          imageS3Region: 'us-east-1'
        })
      ]
    })
  }));

  const items = await listPublicMicroEducation({});

  assert.match(items[0].imagePath, /^https:\/\/test-microeducation-bucket\.s3\.us-east-1\.amazonaws\.com\/microeducation-test\/2026-07-01\/example\.png\?/);
  assert.match(items[0].imagePath, /X-Amz-Signature=/);
  assert.equal(items[0].imageOriginalFileName, 'example.png');
  assert.equal(Object.hasOwn(items[0], 'imageS3Bucket'), false);
});

test('public microeducation list keeps proxy imagePath for local records', async (t) => {
  t.mock.method(AuditLogModel, 'create', async () => ({}));
  t.mock.method(MicroEducationModel, 'find', () => ({
    sort: () => ({
      lean: async () => [
        makeDocument({
          imageStorageProvider: 'local',
          imageStorageKey: '2026-07-01/example.png',
          imageOriginalFileName: 'example.png',
          imageMimeType: 'image/png',
          imageSizeBytes: 123
        })
      ]
    })
  }));

  const items = await listPublicMicroEducation({});

  assert.equal(items[0].imagePath, `/microeducation/${objectId}/image`);
});

test('admin create with image uploads to S3 and stores S3 metadata', async (t) => {
  const s3Commands = [];

  t.mock.method(S3Client.prototype, 'send', async (command) => {
    s3Commands.push(command);
    return {};
  });
  t.mock.method(AuditLogModel, 'create', async () => ({}));
  t.mock.method(MicroEducationModel, 'create', async (payload) => makeDocument(payload));

  const item = await createMicroEducation({}, baseInput, imageFile);
  const putCommand = s3Commands.find(command => command.constructor.name === 'PutObjectCommand');

  assert.ok(putCommand);
  assert.equal(putCommand.input.Bucket, 'test-microeducation-bucket');
  assert.match(putCommand.input.Key, /^microeducation-test\/\d{4}-\d{2}-\d{2}\//);
  assert.equal(putCommand.input.ContentType, 'image/png');
  assert.equal(putCommand.input.ServerSideEncryption, 'AES256');
  assert.equal(item.imagePath, `/microeducation/${objectId}/image?v=1782864000000`);
  assert.equal(item.imageOriginalFileName, 'phishing.png');
});

test('admin update with image uploads replacement and deletes previous S3 object', async (t) => {
  const s3Commands = [];
  const existingItem = makeDocument({
    imageStorageProvider: 's3',
    imageStorageKey: 'microeducation-test/2026-06-01/old.png',
    imageOriginalFileName: 'old.png',
    imageMimeType: 'image/png',
    imageSizeBytes: 10,
    imageS3Bucket: 'test-microeducation-bucket',
    imageS3Region: 'us-east-1',
    set(update) {
      Object.assign(this, update);
      return this;
    },
    async save() {
      return this;
    }
  });

  t.mock.method(S3Client.prototype, 'send', async (command) => {
    s3Commands.push(command);
    return {};
  });
  t.mock.method(AuditLogModel, 'create', async () => ({}));
  t.mock.method(MicroEducationModel, 'findOne', async () => existingItem);

  const item = await updateMicroEducation({}, objectId, { title: baseInput.title }, imageFile);
  const putCommand = s3Commands.find(command => command.constructor.name === 'PutObjectCommand');
  const deleteCommand = s3Commands.find(command => command.constructor.name === 'DeleteObjectCommand');

  assert.ok(putCommand);
  assert.ok(deleteCommand);
  assert.equal(deleteCommand.input.Bucket, 'test-microeducation-bucket');
  assert.equal(deleteCommand.input.Key, 'microeducation-test/2026-06-01/old.png');
  assert.equal(item.imagePath, `/microeducation/${objectId}/image?v=1782864000000`);
});

test('public image endpoint streams S3 image data', async (t) => {
  const s3Commands = [];

  t.mock.method(S3Client.prototype, 'send', async (command) => {
    s3Commands.push(command);

    if (command.constructor.name === 'GetObjectCommand') {
      return {
        Body: Readable.from(Buffer.from('s3-image')),
        ContentType: 'image/png',
        ContentLength: 8
      };
    }

    return {};
  });
  t.mock.method(MicroEducationModel, 'findOne', async () =>
    makeDocument({
      imageStorageProvider: 's3',
      imageStorageKey: 'microeducation-test/2026-07-01/example.png',
      imageOriginalFileName: 'example.png',
      imageMimeType: 'image/png',
      imageSizeBytes: 8,
      imageS3Bucket: 'test-microeducation-bucket',
      imageS3Region: 'us-east-1'
    })
  );

  const image = await getMicroEducationImage({}, objectId);
  const chunks = [];

  for await (const chunk of image.stream) {
    chunks.push(Buffer.from(chunk));
  }

  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.fileSizeBytes, 8);
  assert.equal(Buffer.concat(chunks).toString(), 's3-image');
  assert.deepEqual(
    s3Commands.map(command => command.constructor.name),
    ['HeadObjectCommand', 'GetObjectCommand']
  );
});

test('public image endpoint still streams existing local image records', async (t) => {
  const localKey = '2026-07-01/local.png';
  const localPath = path.join(tempStorageRoot, localKey);

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, Buffer.from('local-image'));

  t.mock.method(MicroEducationModel, 'findOne', async () =>
    makeDocument({
      imageStorageProvider: 'local',
      imageStorageKey: localKey,
      imageOriginalFileName: 'local.png',
      imageMimeType: 'image/png',
      imageSizeBytes: 11
    })
  );

  const image = await getMicroEducationImage({}, objectId);
  const chunks = [];

  for await (const chunk of image.stream) {
    chunks.push(Buffer.from(chunk));
  }

  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.concat(chunks).toString(), 'local-image');
});
