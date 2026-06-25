import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { registerHistoryStorage } from 'xxscreeps-mod-history/storage.js';
import type { HistoryStorage } from 'xxscreeps-mod-history/storage.js';

// Stores gzipped chunks at `<prefix><room>/<base>.json.gz`.
class S3HistoryStorage implements HistoryStorage {
	private readonly client: S3Client;

	constructor(
		private readonly bucket: string,
		private readonly prefix: string,
		region?: string,
		endpoint?: string,
	) {
		this.client = new S3Client({
			...region ? { region } : {},
			...endpoint ? { endpoint, forcePathStyle: true } : {},
		});
	}

	private key(room: string, base: number) {
		return `${this.prefix}${room}/${base}.json.gz`;
	}

	async save(room: string, base: number, gz: Uint8Array): Promise<void> {
		await this.client.send(new PutObjectCommand({
			Bucket: this.bucket,
			Key: this.key(room, base),
			Body: gz,
			ContentType: 'application/json',
			ContentEncoding: 'gzip',
		}));
	}

	async load(room: string, base: number): Promise<Uint8Array | null> {
		try {
			const res = await this.client.send(new GetObjectCommand({
				Bucket: this.bucket,
				Key: this.key(room, base),
			}));
			const bytes = await res.Body?.transformToByteArray();
			return bytes ? Buffer.from(bytes) : null;
		} catch (err) {
			if ((err as { name?: string }).name === 'NoSuchKey') {
				return null;
			}
			throw err;
		}
	}

	async cleanup(beforeTick: number): Promise<void> {
		let token: string | undefined;
		do {
			const list = await this.client.send(new ListObjectsV2Command({
				Bucket: this.bucket,
				Prefix: this.prefix,
				ContinuationToken: token,
			}));
			const stale = (list.Contents ?? [])
				.filter(object => {
					const match = /\/(\d+)\.json\.gz$/.exec(object.Key ?? '');
					return match !== null && Number(match[1]) < beforeTick;
				})
				.map(object => ({ Key: object.Key! }));
			if (stale.length > 0) {
				await this.client.send(new DeleteObjectsCommand({
					Bucket: this.bucket,
					Delete: { Objects: stale },
				}));
			}
			token = list.IsTruncated ? list.NextContinuationToken : undefined;
		} while (token);
	}
}

registerHistoryStorage('s3', opts => {
	if (!opts.bucket) {
		throw new Error("history.bucket is required for the 's3' backend");
	}
	const prefix = opts.prefix ? opts.prefix.replace(/\/?$/, '/') : '';
	return new S3HistoryStorage(opts.bucket, prefix, opts.region, opts.endpoint);
});
