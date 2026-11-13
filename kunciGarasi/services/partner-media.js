const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  multer = require("multer");
const { bad } = require("../lib/workshop-utils");
const sharp = require("sharp");
async function decodeImage(buffer) {
  imageType(buffer);
  try {
    const image = sharp(buffer, {
      failOn: "warning",
      limitInputPixels: 24000000,
    });
    const metadata = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      metadata.pages > 1
    )
      throw Error("Unsupported image");
    const output = await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    if (output.length > 3 * 1024 * 1024) throw Error("Image too large");
    return output;
  } catch {
    throw bad(
      "Foto rusak, terlalu besar atau tidak dapat dibaca. Unggah JPEG/PNG/WebP utuh, maksimal 24 megapiksel.",
    );
  }
}
const directory = path.join(__dirname, "../../data/uploads");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 5, fields: 3, fieldSize: 65536 },
}).fields([
  { name: "workshopPhotos", maxCount: 4 },
  { name: "towPhoto", maxCount: 1 },
]);
function imageType(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "jpg";
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw bad("Foto harus berupa JPEG, PNG atau WebP yang valid.");
}
async function savePhotos(files, input) {
  const shops = files?.workshopPhotos || [],
    tow = files?.towPhoto || [];
  if (!shops.length) throw bad("Minimal satu foto bengkel wajib diunggah.");
  if (input.pickup && !tow.length)
    throw bad(
      "Foto kendaraan derek wajib saat layanan penjemputan/derek dipilih.",
    );
  const all = [
    ...shops.map((f) => ({ ...f, kind: "workshop" })),
    ...(input.pickup ? tow : []).map((f) => ({ ...f, kind: "tow" })),
  ];
  const descriptors = [];
  for (const f of all) {
    const buffer = await decodeImage(f.buffer);
    descriptors.push({
      f: { buffer },
      id: crypto.randomBytes(20).toString("hex") + ".webp",
      kind: f.kind,
    });
  }
  await fs.mkdir(directory, { recursive: true });
  const saved = [];
  try {
    for (const { f, id, kind } of descriptors) {
      await fs.writeFile(path.join(directory, id), f.buffer, { flag: "wx" });
      saved.push({ id, kind });
    }
    return saved;
  } catch (e) {
    await removePhotos(saved);
    throw e;
  }
}
async function removePhotos(items) {
  await Promise.all(
    (items || []).map((f) =>
      fs.unlink(path.join(directory, f.id)).catch(() => {}),
    ),
  );
}
module.exports = {
  upload,
  savePhotos,
  removePhotos,
  imageType,
  decodeImage,
  directory,
};
