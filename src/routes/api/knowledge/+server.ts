import {
	addKnowledgeDocument,
	deleteKnowledgeDocument,
	listKnowledgeDocuments
} from '$lib/server/knowledge';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_FILE_SIZE = 250_000;

export const GET: RequestHandler = () => {
	try {
		return json({ documents: listKnowledgeDocuments() });
	} catch {
		return json({ error: 'The local knowledge store is unavailable.' }, { status: 503 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const contentLength = Number(request.headers.get('content-length'));
	if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
		return json({ error: 'A bounded Content-Length is required.' }, { status: 411 });
	}
	if (contentLength > MAX_FILE_SIZE + 10_000) {
		return json({ error: 'Document must be smaller than 250 KB.' }, { status: 413 });
	}

	try {
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || !file.size || file.size > MAX_FILE_SIZE) {
			return json({ error: 'Select a document smaller than 250 KB.' }, { status: 400 });
		}

		const name = file.name.split(/[\\/]/).pop()?.slice(0, 200) ?? '';
		if (!/\.(?:md|txt)$/i.test(name)) {
			return json({ error: 'Only Markdown and text documents are supported.' }, { status: 400 });
		}

		const content = await file.text();
		if (!content.trim()) return json({ error: 'Document is empty.' }, { status: 400 });

		const document = await addKnowledgeDocument(name, content);
		return json({ document }, { status: 201 });
	} catch {
		return json(
			{ error: 'Could not index the document. Check the local embedding model installation.' },
			{ status: 500 }
		);
	}
};

export const DELETE: RequestHandler = ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	if (!Number.isSafeInteger(id) || id < 1) {
		return json({ error: 'A valid document ID is required.' }, { status: 400 });
	}

	try {
		return deleteKnowledgeDocument(id)
			? new Response(null, { status: 204 })
			: json({ error: 'Document not found.' }, { status: 404 });
	} catch {
		return json({ error: 'Could not delete the document.' }, { status: 500 });
	}
};
