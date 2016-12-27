import * as ts from 'typescript';
import fs = require('fs');
import path = require('path');
import chai = require('chai');

import {Resolver} from '../src/resolver';
import {TypeChecker} from '../src/type-checker';
import {CompilerHost} from '../src/compiler-host';
import {formatErrors} from '../src/format-errors';
import {parseConfig} from '../src/parse-config';

const should = chai.should();
const defaultOptions = parseConfig({});

const missingFile = '/somefolder/fixtures-es6/program1/missing-file.ts';
const missingImport = require.resolve('./fixtures-es6/program1/missing-import.ts');
const syntaxError = require.resolve('./fixtures-es6/program1/syntax-error.ts');
const referenceSyntaxError = require.resolve('./fixtures-es6/program1/ref-syntax-error.ts');
const typeError = require.resolve('./fixtures-es6/program1/type-error.ts');
const nestedTypeError = require.resolve('./fixtures-es6/program1/nested-type-error.ts');
const noImports = require.resolve('./fixtures-es6/program1/no-imports.ts');
const oneImport = require.resolve('./fixtures-es6/program1/one-import.ts');
const ambientReferenceDisabled = require.resolve('./fixtures-es6/ambients/ambient-reference-disabled.ts');
const nestedReference = require.resolve('./fixtures-es6/ambients/ambient-nested.ts');
const backslashReference = require.resolve('./fixtures-es6/ambients/backslash-reference.ts');
const ambientImportJs = require.resolve('./fixtures-es6/ambients/ambient-import-js.ts');
const ambientRequires = require.resolve('./fixtures-es6/ambients/ambient-requires.ts');
const refImport = require.resolve('./fixtures-es6/program1/ref-import.ts');
const externalEntry = require.resolve('./fixtures-es6/external/entry.ts');
const circularFile = require.resolve('./fixtures-es6/circular/circular.ts');
const importCss = require.resolve('./fixtures-es6/css/import-css.ts');
const importHtml = require.resolve('./fixtures-es6/html/import-html.ts');
const importHtmlCjs = require.resolve('./fixtures-es6/html/import-html-cjs.ts');
const angular2Typings = require.resolve('./fixtures-es6/typings/angular2-typings.ts');
const rxjsTypings = require.resolve('./fixtures-es6/typings/rxjs-typings.ts');
const missingTypings = require.resolve('./fixtures-es6/typings/missing-typings.ts');
const cssTypings = require.resolve('./fixtures-es6/typings/css-typings.ts');
const missingPackage = require.resolve('./fixtures-es6/typings/missing-package.ts');
const augGlobal = require.resolve('./fixtures-es6/augmentation/global.ts');
const augAmbient = require.resolve('./fixtures-es6/augmentation/ambient.ts');
const augAmbientGlobal = require.resolve('./fixtures-es6/augmentation/ambient-global.ts');
const augExternal = require.resolve('./fixtures-es6/augmentation/external.ts');

let metadata = {};
function lookup(address: string): any {
   return Promise.resolve(metadata[address] || {});
}

function resolve(dep, parent) {
   //console.log("resolving " + parent + " -> " + dep);
   let result = "";

   try {
      if (dep[0] === '/')
         result = dep;
      else if (dep[0] === '.')
         result = path.join(path.dirname(parent), dep);
      else {
         result = path.join(path.dirname(parent), "resolved", dep);

			var name = dep[0] === '@' ? dep.slice(dep.indexOf('/') + 1) : dep;
			if (name.indexOf('/') < 0)
				result = result + '/' + name;

         if (dep === "ambient/ambient")
            result = result + ".ts";

         if (path.extname(result) === "")
            result = result + ".js";
      }

      if (path.extname(result) === "")
         result = result + ".ts";

      //console.log("resolved " + parent + " -> " + result);
      return Promise.resolve((ts as any).normalizePath(result));
   }
   catch (err) {
      console.error(err);
      return Promise.reject(err)
   }
}

describe('TypeChecker', () => {

   let typeChecker: TypeChecker;
   let resolver: Resolver;
   let host: CompilerHost;

   async function resolveAll(filelist: string[], options: ts.CompilerOptions) {
      const resolutions = filelist.map((filename) => {
         filename = (ts as any).normalizePath(filename);
         let text = fs.readFileSync(filename, 'utf8');
         host.addFile(filename, text, options.target);
         return resolver.resolve(filename, options);
      });

      const resolved = await Promise.all(resolutions);
      const unlookuped = resolved.reduce((result, deps) => {
         const files = deps.list.filter(dep => !host.fileExists(dep) && (result.indexOf(dep) < 0));
         return result.concat(files);
      }, []);

      if (unlookuped.length > 0) {
         await resolveAll(unlookuped, options);
      }
   }

   async function typecheckAll(filename: string, options: ts.CompilerOptions) {
		host.getDefaultLibFilePaths(options).forEach(libFile => {
			resolver.registerDeclarationFile((ts as any).normalizePath(require.resolve(libFile)));
		});
      await resolveAll([filename], options);
      let result = typeChecker.check(options);

      if (result.length == 0)
         result = typeChecker.forceCheck(options);

      return result;
   }

   beforeEach(() => {
      host = new CompilerHost();
      typeChecker = new TypeChecker(host);
      resolver = new Resolver(host, resolve, lookup);
   });

   it('compiles successfully', async () => {
      const diags = await typecheckAll(noImports, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('uses config options', async () => {
      const options = parseConfig({
         noUnusedLocals: true
		});

      const diags = await typecheckAll(oneImport, options);
      //formatErrors(diags, console as any);
      diags.should.have.length(2);
      diags[0].code.should.be.equal(6133);
		diags[1].code.should.be.equal(6133);
   });

   it('compiles ambient imports', async () => {
      const diags = await typecheckAll(ambientImportJs, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('catches type errors', async () => {
      const diags = await typecheckAll(typeError, defaultOptions);
      diags.should.have.length(1);
      diags[0].code.should.be.equal(2322);
   });

   it('only checks fully resolved typescript files', async () => {
      const options = parseConfig({
         noImplicitAny: true
		});
      host.addFile("declaration.d.ts", "export var a: string = 10;", options.target);

      await resolver.resolve("declaration.d.ts", options);
      let diags = typeChecker.check(options);
      diags.should.have.length(0);

      host.addFile("index.ts", '/// <reference path="declaration.d.ts" />', options.target);
      await resolver.resolve("index.ts", options)
      diags = typeChecker.check(options);
      diags.should.not.have.length(0);
   });

   it('forceChecks files even if dependencies have not been loaded', async () => {
      const options = parseConfig({
         noImplicitAny: true
		});

		const libName = (ts as any).normalizePath(require.resolve(host.getDefaultLibFileName(options)));
		resolver.registerDeclarationFile(libName);
		host.addFile(libName, fs.readFileSync(libName, 'utf8'), options.target);

      // should pass normal check and fail forceCheck
      host.addFile("index.ts", '/// <reference path="declaration.d.ts" />\n import a from "amodule"; export = a;', options.target);
      await resolver.resolve("index.ts", options)
      let diags = typeChecker.check(options);
      diags.should.have.length(0);
      diags = typeChecker.forceCheck(options);
      diags.should.not.have.length(0);

      // now passes forceCheck
      host.addFile("declaration.d.ts", "declare module 'amodule' { export var a: number; }", options.target);
      await resolver.resolve("declaration.d.ts", options);
      diags = typeChecker.forceCheck(options);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('handles backslash in references', async () => {
      const diags = await typecheckAll(backslashReference, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('loads nested reference files', async () => {
      const diags = await typecheckAll(nestedReference, defaultOptions)
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('catches syntax errors', async () => {
      const diags = await typecheckAll(syntaxError, defaultOptions);
      diags.should.have.length(3);
   });

   it('catches syntax errors in reference files', async () => {
      const diags = await typecheckAll(referenceSyntaxError, defaultOptions);
      diags.should.have.length(9);
   });

   it('handles ambient references when resolveAmbientRefs option is false', async () => {
      const diags = await typecheckAll(ambientReferenceDisabled, defaultOptions);
      diags.should.have.length(0);
   });

   it('handles ambient javascript imports', async () => {
      const diags = await typecheckAll(ambientImportJs, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('handles circular references', async () => {
      const diags = await typecheckAll(circularFile, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('handles ambients with internal requires', async () => {
      const diags = await typecheckAll(ambientRequires, defaultOptions);
      diags.should.have.length(0);
   });

   it('handles external imports', async () => {
      const diags = await typecheckAll(externalEntry, defaultOptions);
      diags.should.have.length(0);
   });

   it('imports .css files', async () => {
      const diags = await typecheckAll(importCss, defaultOptions);
      diags.should.have.length(0);
   });

   it('imports .html files', async () => {
      const diags = await typecheckAll(importHtmlCjs, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('imports es6 .html files', async () => {
      const options = parseConfig({
         module: "es2015"
		});
      const diags = await typecheckAll(importHtml, options);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('loads lib.es6.d.ts', async () => {
      const diags = await typecheckAll(noImports, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('loads es5, es2015.promise', async () => {
      const options = parseConfig({
			lib: ['es5', 'es2015.promise']
		});
      const diags = await typecheckAll(noImports, options);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
   });

   it('hasErrors returns true when errors are present', async () => {
      const diags = await typecheckAll(syntaxError, defaultOptions);
      diags.should.have.length(3);
      typeChecker.hasErrors().should.be.true;
   });

   it('hasErrors returns false when errors are not present', async () => {
      const diags = await typecheckAll(noImports, defaultOptions);
      formatErrors(diags, console as any);
      diags.should.have.length(0);
      typeChecker.hasErrors().should.be.false;
   });

	describe("Typings", () => {
		it('resolve typings files when typings meta is present', async () => {
			let jsfile = path.resolve(__dirname, './fixtures-es6/typings/resolved/@angular2/core/core.js');
			jsfile = (ts as any).normalizePath(jsfile);

			metadata = {};
			metadata[jsfile] = {
				typings: true
			};

			const diags = await typecheckAll(angular2Typings, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
		});

		xit('doesnt resolve typings files when typings meta not present', async () => {
			metadata = {};

			const diags = await typecheckAll(angular2Typings, defaultOptions);
			//formatErrors(diags, console as any);
			diags.should.have.length(1);
			diags[0].code.should.be.equal(2307);
		});

		it('resolves typings when typings is non-relative path', async () => {
			let  jsfile = path.resolve(__dirname, './fixtures-es6/typings/resolved/rxjs/rxjs.js');
			jsfile = (ts as any).normalizePath(jsfile);

			metadata = {};
			metadata[jsfile] = {
				typings: "Rx.d.ts"
			};

			const diags = await typecheckAll(rxjsTypings, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
		});

		it('resolves typings for css files', async () => {
	      const options = parseConfig({
				typings: {
					'cssmodules/mystyles.css': true
				}
			});
			const diags = await typecheckAll(cssTypings, options);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
		});

		it('resolves string typings for css files', async () => {
	      const options = parseConfig({
				typings: {
					'cssmodules/mystyles.css': 'mystyles.d.ts'
				}
			});
			const diags = await typecheckAll(cssTypings, options);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
		});
	});

	describe("Augmentation", () => {
		it('handles global augmentation', async () => {
			const diags = await typecheckAll(augGlobal, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
			typeChecker.hasErrors().should.be.false;
		});

		it('handles ambient augmentation', async () => {
			const diags = await typecheckAll(augAmbient, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
			typeChecker.hasErrors().should.be.false;
		});

		it('handles ambient global augmentation', async () => {
			const diags = await typecheckAll(augAmbientGlobal, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
			typeChecker.hasErrors().should.be.false;
		});

		it('handles external augmentation', async () => {
			let  jsfile = path.resolve(__dirname, './fixtures-es6/augmentation/resolved/somelib/somelib.js');
			jsfile = (ts as any).normalizePath(jsfile);

			metadata = {};
			metadata[jsfile] = {
				typings: "somelib.d.ts"
			};

			const diags = await typecheckAll(augExternal, defaultOptions);
			formatErrors(diags, console as any);
			diags.should.have.length(0);
			typeChecker.hasErrors().should.be.false;
		});

	})
});
