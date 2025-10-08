/* global hexo */

'use strict';

// Add comment
hexo.extend.filter.register('theme_inject', injects => {
  let theme = hexo.theme.config;
  if (!theme.utteranc.enable) return;

  injects.comment.raw('gitalk', '<script src="https://utteranc.es/client.js" \
                                    repo="liwenkun/liwenkun.github.io" \
                                    issue-term="pathname" \
                                    theme="github-dark" \
                                    crossorigin="anonymous" \
                                    async> \
                                </script>', {}, {cache: true});

});
