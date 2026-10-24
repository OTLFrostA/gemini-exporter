/** Native GET /api/organizations response bodies. */
const fixtureMap = {
    'CL_SOURCE_DISCOVERY_ORGANIZATIONS_01': (): { uuid: string }[] => [],
};

export function organizationsGen(key: keyof typeof fixtureMap): { uuid: string }[] {
    return fixtureMap[key]();
}
