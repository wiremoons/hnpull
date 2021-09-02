#!/usr/bin/env -S deno run --quiet --allow-net=hacker-news.firebaseio.com --location https://wiremoons.com/
/**
 * @file hn-pull.ts
 * @brief Monitor and pull the latest Hacker News stories.
 *
 * @author     simon rowe <simon@wiremoons.com>
 * @license    open-source released under "MIT License"
 * @source     https://github.com/wiremoons/hn-pull
 *
 * @date originally created: 24 Aug 2021
 * @date updated significantly: 31 Aug 2021
 *
 * @details Program uses the Hacker News (HN) Application Programming Interface (API) to monitor for newly posted
 * Hacker News stories. The API can be found here: https://github.com/HackerNews/API
 * Application is written in TypeScript for use with the Deno runtime: https://deno.land/
 *
 * @note The program can be run with Deno using the command:
 * @code deno run --quiet --allow-net=hacker-news.firebaseio.com --location https://wiremoons.com/ ./hn-pull.ts
 */

/**
 * @note The following application enhancements are anticipated:
 * @todo offload output to a Worker?
 * @todo different output options:  text with colour / JSON / into SQlite / HTML
 * @todo add delay in request retrieval so not to overload HN site on long pulls
 * @todo add version and help command line params and output options
 * @todo move all `fetch` requests to one function and wrap in `try/catch`
 */

// modules imported
import { delay } from "https://deno.land/std@0.106.0/async/delay.ts";
import { format, toIMF } from "https://deno.land/std@0.106.0/datetime/mod.ts";

/** Base URL for all calls to the Hacker News API */
const baseURL = "https://hacker-news.firebaseio.com/v0";

//--------------------------------
// UTILITY FUNCTIONS
//--------------------------------

/** Type guard for string */
// deno-lint-ignore no-explicit-any
function _isString(arg: any): arg is string {
  return arg !== undefined;
}

/** Type Guard for number */
// deno-lint-ignore no-explicit-any
function isNumber(arg: any): arg is number {
  return arg !== undefined;
}

/** Convert epoch date to date and time for display in output as a string */
function getDisplayDateTime(epochTime: number): string {
  //console.log(`Epoch time for conversion to data and time: ${epochTime}`);
  let dateUTC: Date;
  if (isNumber(epochTime)) {
    dateUTC = new Date(epochTime * 1000);
    //console.log(`Converted date to UTC format: ${dateUTC}`);
    return toIMF(new Date(dateUTC));
    //console.log(`Final data and time format: ${toIMF(new Date(dateUTC))}`);
  } else {
    return "UNKNOWN";
  }
}

/** Convert an epoch time to a formatted date (no time) for display in output as a string */
function getDisplayDate(epochTime: number): string {
  //console.log(`Epoch time for conversion to a date: ${epochTime}`);
  let dateUTC: Date;
  if (isNumber(epochTime)) {
    dateUTC = new Date(epochTime * 1000);
    //console.log(`Converted date to UTC format: ${dateUTC}`);
    //return date only using `formatString`
    return format(dateUTC, "dd-MM-yyyy");
  } else {
    return "UNKNOWN";
  }
}

//--------------------------------
// APPLICATION FUNCTIONS
//--------------------------------

// define each item supported by HackerNews API
// See: https://github.com/HackerNews/API
interface Item {
  readonly id: number;
  readonly type?: string;
  readonly by?: string;
  readonly title?: string;
  readonly url?: string;
  readonly text?: string;
  readonly time?: number;
  readonly score?: number;
  readonly descendants?: number;
  readonly deleted?: boolean;
  readonly dead?: boolean;
  readonly parent?: number;
  readonly kids?: number[];
  readonly poll?: number;
  readonly parts?: number[];
}

/**
 * Request the newest published Hacker News item ID retrieved from the Hacker Mews API call.
 * @code https://hacker-news.firebaseio.com/v0/maxitem.json
 * @return The retrieved HN item or `-1` if unable to parse as an integer (ie NaN)
 */
async function getMaxID(): Promise<number> {
  const endpoint = `${baseURL}/maxitem.json`;
  const res = await fetch(endpoint);
  const item = await res.json();
  return (parseInt(item)) || -1;
}

/**
 *  Returns the requested Hacker News article as an `Item` for the provided HN 'ID'.
 *  @code https://hacker-news.firebaseio.com/v0/item/<ID>.json
 *  @param id The number of the Hacker News article to request from the HN API.
 *  @return A copy or the `Item` interface record from the HN API or `undefined` if unknown.
 */
async function getItemByID(id: number): Promise<Item | undefined> {
  const endpoint = `${baseURL}/item/${id}.json`;
  const res = await fetch(endpoint);
  const item = await res.json();
  return item ?? undefined;
}

/**
 * Obtain HN user info for the given user ID
 * @code https://hacker-news.firebaseio.com/v0/user/<userID>.json
 */
async function getUserData(userID: string): Promise<string> {
  if (userID && userID !== "unknown author") {
    const endpoint = `${baseURL}/user/${userID}.json`;
    const res = await fetch(endpoint);
    const item = await res.json();
    return `account since ${getDisplayDate(item.created)}. ` +
        `[karma: ${item.karma}]` ??
      `[karma: undefined]`;
  } else {
    return "UNKNOWN";
  }
}

/**
 * Attempts to write the provided Hacker News item ID into `localStorage` using `Storage.setItem`.
 * @param hnID Hacker News items ID to be stored against key `hnIdKey`
 * @return When the param provided is greater than `0` and its storage was attempted then will be `true`
 * @see If needed an alternative approach to using `localStorage` might be:
 * @code https://deno.land/x/config_dir@v0.1.1/mod.ts
 */
function setLastId(hnID: number): boolean {
  if (isNumber(hnID) && hnID >= 0) {
    localStorage.setItem("hnIdKey", `${hnID}`);
    return true;
  }
  return false;
}

/**
 * Check and retrieve Hacker New last seen story ID from `localStorage`
 * @returns last stored HackerNews item ID or `-1` on failure
 * @see If needed an alternative approach to using `localStorage` might be:
 * @code https://deno.land/x/config_dir@v0.1.1/mod.ts
 */
function getLastId(): number {
  try {
    if (localStorage.length > 0) {
      return parseInt(localStorage.getItem("hnIdKey") ?? "-1");
    }
  } catch (err) {
    console.error(`\nERROR: trying to retrieved HN ID failed with: '${err}'\n`);
    console.error(
      "Access to 'localStorage' is required by specifying  '--location https://wiremoons.com/' \ " +
        "as a command line flag when running the program. Exit.\n",
    );
    Deno.exit(1);
  }

  return -1;
}

/** Continuously stream any new story items added to HN - check every 120 secs in a loop */
async function streamStory() {
  // check if a localStorage hnID exists from previous execution
  let id = getLastId();
  console.log(`Retrieved localStorage HN ID: ${id}`);

  // current HN items ID
  const nowId = await getMaxID();

  // if `localStorage` `id` exists and is greater than zero use it.
  // Otherwise use the current HN ID from the site.
  id = (id > 0) ? id : nowId;

  // check how many new HN IDs have been missed
  const diffId = (nowId - id);
  console.log(`New HN items since last run: ${diffId}`);

  if (diffId > 100) {
    // more than 100 new HN items exists - so ensure we really want to retrieve them
    console.log(
      `\nWARNING: more than 100 (ie '${diffId}') new HN articles to be checked!`,
    );
    if (
      confirm(
        `Retrieve ALL anyway ('y')  OR  start with current newest ('n') [RECOMMENDED] ?`,
      )
    ) {
      console.log(`'${diffId}' HN items to be retrieved and processed...`);
      // delay to allow user to abort with Ctrl + C if not intended
      await delay(3 * 1000);
    } else {
      id = nowId;
      console.log(`Reset to newest HN ID: '${id}'...`);
      // delay to allow user to abort with Ctrl + C if not intended
      await delay(3 * 1000);
    }
  }

  // set to track starting point and how many stories found
  const startId = id;
  let skippedId = 0;
  let storyId = 0;

  // create a text encoder used for updates in check loop below
  const encoder = new TextEncoder();

  console.log(`Starting with Hacker News ID: '${startId}'`);
  console.log("Waiting for new HN stories... checking every 2 minutes\n");

  // keep running forever so suppress warning in Webstorm below:
  // noinspection InfiniteLoopJS
  while (true) {
    const item = await getItemByID(id);

    // If item does not exists or returns `undefined`...
    if (!item) {
      // check current `id` against max HN ID as might have a bad `null` record...
      if (id < (await getMaxID())) {
        // skip a record and re-try as more exist...
        id += 1;
        skippedId += 1;
        continue;
      }
      // display the current time to show when last HN item was checked
      await Deno.stdout.write(
        encoder.encode(`Last check: ${(format(new Date(), "HH:mm"))}`),
      );
      // sleep for 120 seconds (2 minutes)
      await delay(120 * 1000);
      // move cursor to col 0; clear last time check; move cursor to col 0;
      await Deno.stdout.write(encoder.encode(`\r                  \r`));
      continue;
    }

    // Manage the stories to be excluded
    // extract from current `item` the following values it includes
    const { type, deleted, dead } = item;
    // define items to ignore as 'removed'
    const removed = deleted || dead || false;

    //types available: comment / story / poll / job / pollopt
    if (type === "story" && !removed) {
      // get comments author if any exists
      const author = item.by ?? "unknown author";
      const hnURL = `https://news.ycombinator.com/item?id=${id}`;
      storyId += 1;

      // print the story data to screen
      console.log(`
      Title:      '${item.title || "NONE"}'
      HN link:     ${hnURL}
      Story URL:   ${item.url || "NONE"}
      Posted by:  '${author}' ${await getUserData(author)}
      Posted on:   ${getDisplayDateTime(item.time ?? Date.now())}.
      Exec stats: '${storyId}' displayed. '${skippedId}' omitted . '${id -
        startId}' total scanned.
      `);
    }

    // save the latest 'id' checked to `localStorage`
    setLastId(id);
    // increment `id` so next possible HN item can be checked
    id += 1;
  }
}

//--------------------------------
// MAIN
//--------------------------------
if (import.meta.main) {
  await streamStory();
}
