app [Context, program] { pf: platform "https://github.com/Eldhus/roux/releases/download/v0.2.0/J795hZ4DRD6UCp2KPkdLG2nKnq45N6FwTpgkjLSiPyqA.tar.zst" }

## roux-tutor: the tutorial is this app. Every page you read is a template
## in templates/, filled from the Roc below; each lesson asks you to
## change one of them, and `./roux dev main.roc` puts the change on the
## page as you save.

import pf.Server
import pf.Rocstache
import pf.Sqlite
import pf.Sse
import pf.File
import pf.Url
import db/Database
import db/Guestbook
import db/Likes
import templates/Hello
import templates/Welcome
import templates/Markup
import templates/Data
import templates/Types
import templates/Lists
import templates/Routes
import templates/Tests
import templates/Book
import templates/Live
import templates/Ship
import templates/NotFound
import templates/Greeting
import templates/LikeCount

# ── Your turn ──────────────────────────────────────────────────────────────

## Lesson 2: who the greeting is for.
you = "friend"

## Lesson 3 adds a field here. `Hello.Ctx` is what templates/Hello.rocstache
## reads: roux wrote that type, in templates/Hello.roc.
hello : Hello.Ctx
hello = { name: you }

## Lesson 4: the menu. Add a dish.
dishes : List({ name : Str, price : U32 })
dishes = [
	{ name: "Roux", price: 120 },
	{ name: "Velouté", price: 240 },
	{ name: "Espagnole", price: 310 },
]

# ── The app ────────────────────────────────────────────────────────────────

Context : { db : Sqlite.Db }

program = { init!, respond! }

## Once, at start: the database (made from db/schema.sql the first time).
init! : () => Try({ config : Server.Config, context : Context }, [Exit(I64), DbErr(Sqlite.Err)])
init! = || {
	db = Sqlite.open!(Database.at("tutor.db"), { synchronous: Normal })?
	Ok({ config: { port: 8080, static_dir: "static" }, context: { db: db } })
}

Err : [NotFound, BadRequest(Str), DbErr(Sqlite.Err), FileErr(File.FileErr), SseErr(Sse.SseErr)]

## Every request. The pages that only show data are `page`, pure; the
## ones that read a file or the database are here.
respond! : Server.Request, Context => Try(Server.Response(_), Err)
respond! = |request, { db }| {
	path = path_of(request.target)
	match (request.method, path) {
		("GET", "/data") => data!()
		("GET", "/guestbook") => book!(db, request)
		("POST", "/guestbook") => sign!(db, request)
		("GET", "/live") => live!(db, request)
		("POST", "/like") => like!(db, request)
		("GET", _) =>
			match page(path) {
				Ok(response) => Ok(response)
				Err(NotFound) => Ok(not_found(path))
			}
		_ => Ok(not_found(path))
	}
}

## The pages made from data alone: no effects, so `roc test` can call it.
page : Str -> Try(Server.Response(_), [NotFound])
page = |path|
	match path.split_on("/") {
		["", ""] => Ok(Rocstache.html(Welcome.template({ frame: frame("/"), nav: nav("/") })))
		["", "markup"] => Ok(Rocstache.html(Markup.template({ frame: frame("/markup"), nav: nav("/markup"), hello })))
		["", "types"] => Ok(Rocstache.html(Types.template({ frame: frame("/types"), nav: nav("/types"), hello })))
		["", "lists"] => Ok(Rocstache.html(Lists.template({ frame: frame("/lists"), nav: nav("/lists"), menu: { dishes: dishes } })))
		["", "routes"] => Ok(Rocstache.html(Routes.template({ frame: frame("/routes"), nav: nav("/routes") })))
		["", "tests"] => Ok(Rocstache.html(Tests.template({ frame: frame("/tests"), nav: nav("/tests") })))
		["", "ship"] => Ok(Rocstache.html(Ship.template({ frame: frame("/ship"), nav: nav("/ship") })))
		# Lesson 5: a route of your own goes here.
		_ => Err(NotFound)
	}

## Lesson 2 shows the module roux wrote for templates/Hello.rocstache: read
## now, so the page shows it as it is.
data! : () => Try(Server.Response(_), Err)
data! = || {
	generated = File.read_utf8!("templates/Hello.roc", 64 * 1024)?
	Ok(Rocstache.html(Data.template({ frame: frame("/data"), nav: nav("/data"), hello, generated })))
}

# ── Lesson 7: the guestbook ────────────────────────────────────────────────

book! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
book! = |db, request| {
	signatures = Guestbook.recent!(Sqlite.read(db, request))?
	Ok(Rocstache.html(Book.template({ frame: frame("/guestbook"), nav: nav("/guestbook"), signatures })))
}

## A signature from the form: written, then back to the page (303), so a
## reload does not sign twice.
sign! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
sign! = |db, request| {
	form = Str.from_utf8_lossy(Server.read_body!(request, 4096) ? |_| BadRequest("the form"))
	name = field(form, "name")?
	message = field(form, "message")?
	tx = Sqlite.write!(db, request)?
	Guestbook.sign!(tx, { name, message }) ? |_| BadRequest("a name of 1-40 characters, a message of at most 280")
	Sqlite.commit!(tx)?
	Ok({ status: 303, headers: [{ name: "Location", value: "/guestbook" }], body: Bytes([]) })
}

field : Str, Str -> Try(Str, [BadRequest(Str)])
field = |form, key|
	match Url.query_value("?${form}", key) {
		Ok(value) => Ok(value.trim())
		Err(_) => Err(BadRequest("the form has no ${key}"))
	}

# ── Lesson 8: live, with Datastar ──────────────────────────────────────────

live! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
live! = |db, request| {
	{ count } = Likes.count!(Sqlite.read(db, request))?
	Ok(Rocstache.html(Live.template({ frame: frame("/live"), nav: nav("/live"), likes: { count: count } })))
}

## A click: the count goes up in the database, and the new count goes back
## as a Datastar patch, which replaces the element with its id.
like! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
like! = |db, request| {
	tx = Sqlite.write!(db, request)?
	{ count } = Likes.like!(tx)?
	Sqlite.commit!(tx)?
	stream = Sse.start!(request, [])?
	Sse.send!(stream, Rocstache.patch!(LikeCount.template({ count: count })))?
	Sse.end!(stream)
}

# ── The frame every page shares ────────────────────────────────────────────

lessons = [
	{ href: "/", name: "Welcome" },
	{ href: "/markup", name: "Markup" },
	{ href: "/data", name: "Data" },
	{ href: "/types", name: "Types" },
	{ href: "/lists", name: "Lists" },
	{ href: "/routes", name: "Routes" },
	{ href: "/tests", name: "Tests" },
	{ href: "/guestbook", name: "Database" },
	{ href: "/live", name: "Live" },
	{ href: "/ship", name: "Ship" },
]

## The page's title and the lessons, this one marked.
frame : Str -> { title : Str, lessons : List({ href : Str, name : Str, number : Str, current : Bool }) }
frame = |here| {
	title: (lessons.find_first(|l| l.href == here) ?? { href: here, name: "Not found" }).name,
	lessons: lessons.map_with_index(|l, i| { href: l.href, name: l.name, number: i.to_str(), current: l.href == here }),
}

## The lessons before and after this one (none at either end).
nav : Str -> { prev : List({ href : Str, name : Str }), next : List({ href : Str, name : Str }) }
nav = |here|
	match lessons.find_first_index(|l| l.href == here) {
		Ok(at) => {
			prev: if at == 0 [] else lessons.sublist({ start: at - 1, len: 1 }),
			next: lessons.sublist({ start: at + 1, len: 1 }),
		}
		Err(NotFound) => { prev: [], next: [] }
	}

not_found : Str -> Server.Response(_)
not_found = |path| {
	status: 404,
	headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
	body: Html(NotFound.template({ frame: frame(""), path })),
}

path_of : Str -> Str
path_of = |target|
	match target.split_first("?") {
		Ok({ before, .. }) => before
		Err(_) => target
	}

# ── Lesson 6: tests ────────────────────────────────────────────────────────

expect page("/nope") == Err(NotFound)

expect
	match page("/lists") {
		Ok({ status: 200, body: Html({ template: Lists(lists), .. }), .. }) => lists.menu.dishes == dishes
		_ => False
	}

expect nav("/").prev == [] and nav("/ship").next == []
