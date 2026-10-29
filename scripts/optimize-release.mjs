import {transform} from 'esbuild';
export async function optimizeText(name,content){
 if(!['styles.css','script.js','content-model.js','assets/fonts/fonts.css'].includes(name))return content;
 return (await transform(content,{loader:name.endsWith('.css')?'css':'js',minifyWhitespace:true,minifySyntax:false,minifyIdentifiers:false,legalComments:'inline',target:'es2020',charset:'utf8'})).code;
}
