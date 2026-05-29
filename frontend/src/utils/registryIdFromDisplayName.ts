export type RegistryIdFromDisplayNameOptions = {
  /** Used when the slug cannot be normalized to a valid id (default: "sandbox"). */
  fallbackSlug?: string;
  /** When true, ids starting with "gcp-" get an "s-" prefix (Skill Registry reserved prefix). */
  skillRegistry?: boolean;
};

/**
 * Maps a display name to a registry-style id: ^[a-z][a-z0-9-]*[a-z0-9]$, max 63.
 * Returns '' if there are no usable characters from the name.
 */
export function registryIdFromDisplayName(
  name: string,
  options?: RegistryIdFromDisplayNameOptions,
): string {
  const fallback = options?.fallbackSlug ?? 'sandbox';
  const skillRegistry = options?.skillRegistry ?? false;

  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return '';

  if (!/^[a-z]/.test(slug)) {
    const rest = slug.replace(/^[^a-z0-9]+/, '');
    slug = rest && /^[a-z]/.test(rest) ? rest : `e-${rest || 'env'}`;
  }

  slug = slug.replace(/-+$/g, '');
  if (!slug) return '';

  if (!/[a-z0-9]$/.test(slug)) {
    slug = `${slug}0`;
  }
  if (slug.length < 2) {
    slug = `${slug}0`;
  }

  if (slug.length > 63) {
    slug = slug.slice(0, 63);
  }
  slug = slug.replace(/-+$/g, '');

  if (!/[a-z0-9]$/.test(slug)) {
    slug = `${slug.replace(/-+$/g, '')}0`;
  }
  if (slug.length < 2) {
    slug = fallback;
  }

  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    slug = fallback;
  }

  slug = slug.slice(0, 63);

  if (skillRegistry && slug.startsWith('gcp-')) {
    slug = `s-${slug}`.slice(0, 63).replace(/-+$/g, '');
    if (!/[a-z0-9]$/.test(slug)) {
      slug = `${slug.replace(/-+$/g, '')}0`;
    }
    if (slug.length < 2 || !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
      slug = fallback;
    }
  }

  return slug.slice(0, 63);
}
