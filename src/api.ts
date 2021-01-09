import fetch from 'node-fetch';
import { GraphQLClient, gql } from 'graphql-request';
import { ReplInfo } from './types';

const gqlClient = new GraphQLClient('https://repl.it/graphql/', {});
gqlClient.setHeaders({
  'X-Requested-With': 'graph',
  'user-agent': 'lol',
  referrer: 'https://repl.it',
});

const ReplInfoFromUrlDoc = gql`
  query ReplInfoFromUrl($url: String!) {
    repl(url: $url) {
      ... on Repl {
        id
        user {
          username
        }
        slug
      }
    }
  }
`;

const ReplInfoFromIdDoc = gql`
  query ReplInfoFromUrl($id: String!) {
    repl(id: $id) {
      ... on Repl {
        id
        user {
          username
        }
        slug
      }
    }
  }
`;

async function getReplInfoByUrl(url: string): Promise<ReplInfo> {
  const result = await gqlClient.request(ReplInfoFromUrlDoc, { url });

  if (!result.repl) {
    throw new Error('unexpected grqphql response for url');
  }

  return {
    id: result.repl.id,
    user: result.repl.user.username,
    slug: result.repl.slug,
  };
}

async function getReplInfoById(id: string): Promise<ReplInfo> {
  const result = await gqlClient.request(ReplInfoFromIdDoc, { id });

  if (!result.repl) {
    throw new Error('unexpected grqphql response for url');
  }

  return {
    id: result.repl.id,
    user: result.repl.user.username,
    slug: result.repl.slug,
  };
}

export async function getReplInfo(input: string): Promise<ReplInfo> {
  if (input.split('-').length === 5) {
    return getReplInfoById(input);
  }

  // Check if user included full URL using a simple regex
  const urlRegex = /(?:http(?:s?):\/\/repl\.it\/)?@(.+)\/([^?\s#]+)/g;
  const match = urlRegex.exec(input);
  if (!match) {
    throw new Error('Please input in the format of @username/replname or full url of the repl');
  }

  const [, user, slug] = match;

  return getReplInfoByUrl(`https://repl.it/@${user}/${slug}`);
}

export async function fetchToken(replId: string, apiKey: string): Promise<string> {
  const r = await fetch(`https://repl.it/api/v0/repls/${replId}/token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-Type': 'application/json',
      'user-agent': 'ezcrosis',
      'x-requested-with': 'ezcrosis',
    },
    body: JSON.stringify({ apiKey }),
  });
  const text = await r.text();

  let res;
  try {
    res = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON while fetching token for ${replId}: ${JSON.stringify(text)}`);
  }

  if (typeof res !== 'string') {
    throw new Error(`Invalid token response: ${JSON.stringify(res)}`);
  }

  return res;
}
